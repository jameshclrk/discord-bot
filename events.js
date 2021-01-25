import chrono from 'chrono-node';
import schedule from 'node-schedule';
import { eventMessage, listEventsMessage, notificationMessage } from "./responses.js";
import Sequelize from 'sequelize';
import { isAdmin } from "./helpers.js";
import config from "./config.js";

const eventModelOptions = {
    message_id: {
        type: Sequelize.STRING,
        unique: true,
    },
    owner_id: Sequelize.STRING,
    channel_id: Sequelize.STRING,
    guild_id: Sequelize.STRING,
    text: Sequelize.TEXT,
    clean_text: Sequelize.TEXT,
    date: Sequelize.DATE,
};

const regChannelOptions = {
    channel_id: {
        type: Sequelize.STRING,
        unique: true,
    },
    guild_id: Sequelize.STRING,
};

class Event extends Sequelize.Model { }

class RegisteredChannel extends Sequelize.Model { }

class EventManager {
    constructor(client) {
        this.events = {};
        this.sequelize = new Sequelize('database', 'user', 'password', {
            host: 'localhost',
            dialect: 'sqlite',
            logging: false,
            // SQLite only
            storage: 'events.sqlite',
        });
        this.discordClient = client;
        Event.init(eventModelOptions, { sequelize: this.sequelize, modelName: 'event' });
        RegisteredChannel.init(regChannelOptions, { sequelize: this.sequelize, modelName: 'registered_channel' });
    }

    // Initialise the database model and add add existing events to runtime
    init = () => {
        this.sequelize.sync();
        Event.findAll()
            .then(allEvents => {
                allEvents.forEach(e => {
                    this.addEvent(e)
                    console.log(`loaded event ${e.id}/${e.message_id}/${e.guild_id} from database`)
                })
            });
    }

    // Send a notification message for an event
    notify = (messageId) => {
        const event = this.events[messageId];
        // We need to fetch the channel and message to be able to get the reactions
        // and send a message in the channel
        this.discordClient.channels.fetch(event.channel_id)
            .then(channel => {
                channel.messages.fetch(messageId, true, true)
                    .then(message => message.reactions.cache.get(config.YES_EMOJI).users.fetch())
                    .then(users => {
                        const attending = users.filter(user => !user.bot).array().join(", ");
                        return channel.send(notificationMessage(event.text, null, attending))
                    })
                    .then(() => {
                        console.log(`event ${messageId} happened! deleting`)
                        return this.deleteEvent(event.owner_id, false, messageId)
                    })
                    .catch(console.error);
            })
            .catch(console.error);
    }

    // Add event to the manager and schedule the job
    addEvent = dbEvent => {
        const job = schedule.scheduleJob(dbEvent.date, () => { this.notify(dbEvent.message_id) })
        dbEvent.job = job
        this.events[dbEvent.message_id] = dbEvent
    }

    // Store event in the database
    storeEvent = async (messageId, authorId, channelId, guildId, text, cleanText, date) => {
        return await Event.create({
            "message_id": messageId,
            "owner_id": authorId,
            "channel_id": channelId,
            "guild_id": guildId,
            "text": text,
            "clean_text": cleanText,
            "date": date,
        });
    }

    // Create a new event based on a message with args
    newEvent = (message, args) => {
        // For an event, we want to take the other arguments as a sentence
        const arg = args.join(" ")
        const cleanMessage = message.cleanContent.replace(`${config.PREFIX}event `, "")
        const currentTime = Date.now()
        const results = chrono.parse(arg, currentTime, { forwardDate: true });

        // Check if the parsing was successful
        if (results.length === 0) {
            message.reply("Couldn't parse the event date/time ¯\\_(ツ)_/¯")
            return
        }

        const text = arg.replace(results[0].text, "");
        const cleanText = cleanMessage.replace(results[0].text, "")
        const date = results[0].date()

        if (date <= currentTime) {
            message.reply("Events should be in the future ¯\\_(ツ)_/¯")
            return
        }

        // We "fake" an event object (it doesn't exist yet) with what's needed in the message...
        message.reply(eventMessage({ clean_text: cleanText, date: date }, "", ""))
            .then((newMessage) => {
                newMessage.react(config.YES_EMOJI);
                newMessage.react(config.NO_EMOJI);
                newMessage.react(config.EXIT_EMOJI);
                let guildId = "";
                if (message.channel.guild) {
                    guildId = message.channel.guild.id
                }
                console.log(`${message.author.username} created event ${message.id}`);
                this.storeEvent(newMessage.id, message.author.id, newMessage.channel.id, guildId, text, cleanText, date)
                    .then(e => {
                        this.addEvent(e)
                        newMessage.edit(eventMessage(e, "", ""))
                    })
            })
            .catch(console.error);
    }

    // Remove an event from manager and database
    deleteEvent = async (userId, admin, messageId) => {
        // Delete only if requester is the owner of the event
        // OR admin is enabled in the config
        if ((config.ADMIN_DELETE && admin) || userId === this.events[messageId].owner_id) {
            // The scheduled job needs to be cancelled, otherwise the notification will still fire
            const job = this.events[messageId].job
            if (job) {
                job.cancel()
            }
            // Fetch and delete the event message
            this.discordClient.channels.fetch(this.events[messageId].channel_id)
                .then(channel => channel.messages.fetch(messageId))
                .then(message => message.delete())
                .catch(console.error)
            // Remove the event from the manager
            delete this.events[messageId]
            // Finally, remove the event from the DB
            await Event.destroy({ where: { message_id: messageId } });
        }
    }

    // Check if a message is an event
    isEvent = (messageId) => {
        return messageId in this.events
    }

    // Handle event reactions
    handleReaction = (messageReaction, user, action) => {
        // Either handle the YES or NO for attendence
        if (messageReaction._emoji.name === config.YES_EMOJI || messageReaction._emoji.name === config.NO_EMOJI) {
            console.log(`${user.username} updated their RSVP for event ${messageReaction.message.id}`)
            this.toggleAttendence(messageReaction, user, action)
                .then(this.updateAttendees(messageReaction))
                .catch(console.error);

            // OR handle the delete reaction
        } else if ((action === "add") && (messageReaction._emoji.name === config.EXIT_EMOJI)) {
            const guild = messageReaction.message.guild;
            let admin = false;
            if (guild) {
                admin = isAdmin(user, guild)
            }
            this.deleteEvent(user.id, admin, messageReaction.message.id)
                .then(() => {
                    console.log(`${user.username} deleted event ${messageReaction.message.id}`);
                })
                .catch(console.error)
        }
    }

    toggleAttendence = (messageReaction, user, action) => {
        // Don't do anything if we're removing a reaction
        if (action === "remove") {
            return Promise.resolve()
        }

        // Figure out the "opposite" emoji to remove
        let toggleEmoji = ""
        if (messageReaction._emoji.name === config.YES_EMOJI) {
            toggleEmoji = config.NO_EMOJI
        } else if (messageReaction._emoji.name === config.NO_EMOJI) {
            toggleEmoji = config.YES_EMOJI
        } else {
            // wtf happened
            return Promise.reject(`Tried to toggle attendence for ${user} with reaction ${messageReaction} ${action}`)
        }

        // As we are only worried about toggling a reaction when ADDING a reaction, we know we should REMOVE the opposite
        return messageReaction.message.reactions.resolve(toggleEmoji).users.remove(user)
    }

    // Update the attendee list when a message has a new reaction
    updateAttendees = (messageReaction) => {
        messageReaction.message.reactions.cache.get(config.YES_EMOJI).users.fetch()
            .then(attendees => {
                return messageReaction.message.reactions.cache.get(config.NO_EMOJI).users.fetch()
                    .then(unavail_users => {
                        const attending = attendees.filter(user => !user.bot).array().join(", ")
                        const unavail = unavail_users.filter(user => !user.bot).array().join(", ");
                        const e = this.events[messageReaction.message.id];
                        return messageReaction.message.edit(eventMessage(e, attending, unavail));
                    })
            })
            .catch(console.error);
    }

    listEvents = (message) => {
        if (message.channel.guild) {
            this.listGuildEvents(message)
        } else {
            this.listChannelEvents(message)
        }
    }

    listGuildEvents = (message) => {
        Event.findAll({ where: { guild_id: message.channel.guild.id } })
            .then(events => {
                return message.reply(listEventsMessage(events))
            })
            .catch(console.error);
    }

    listChannelEvents = (message) => {
        Event.findAll({ where: { guild_id: message.channel.id } })
            .then(events => {
                return message.reply(listEventsMessage(events))
            })
            .catch(console.error);
    }

    registerChannel = (message) => {
        if (isAdmin(message.author, message.channel.guild)) {
            const channel = message.mentions.channels.first();
            if (channel.id && channel.guild.id) {
                RegisteredChannel.create({
                    "channel_id": channel.id,
                    "guild_id": channel.guild.id,
                })
                    .then(e => message.reply(`Registered ${channel} for moderation`))
                    .catch(console.error);
            } else {
                message.reply("Not a valid Text Channel: ignoring")
            }
        }
    }

    unregisterChannel = async (message) => {
        if (isAdmin(message.author, message.channel.guild)) {
            const channel = message.mentions.channels.first();
            const destroyed = await RegisteredChannel.destroy({ where: { channel_id: channel.id, guild_id: channel.guild.id } })
            if (destroyed > 0) {
                message.reply(`Unregistered ${channel} for moderation`)
            } else {
                message.reply(`${channel} not registered`)
            }
        }
    }

    isChannelRegistered = async (channel) => {
        if (!channel || !channel.id || !channel.guild || !channel.guild.id) {
            return false
        }
        const registeredChannel = await RegisteredChannel.findOne({ where: { channel_id: channel.id, guild_id: channel.guild.id } })
        if (registeredChannel) {
            return true
        } else {
            return false
        }
    }

}

export { EventManager };
