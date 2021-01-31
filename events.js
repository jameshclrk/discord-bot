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

class Event extends Sequelize.Model {
    getUrl = () => {
        return `https://discordapp.com/channels/${this.guild_id}/${this.channel_id}/${this.message_id}`
    }
}

class RegisteredChannel extends Sequelize.Model { }

const EventErrors = {
    "OK": 0,
    "DateParse": "Couldn't parse the event date/time ¯\\_(ツ)_/¯",
    "EventInPast": "Events should be in the future ¯\\_(ツ)_/¯",
    "PermissionDenied": "You don't have permission to do that ¯\\_(ツ)_/¯",
    "UnknownReaction": 4,
    "UnknownEvent": 5,
    "NotTextChannel": 6,
}

if (Object.freeze) {
    Object.freeze(EventErrors)
}

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

    parseEventMessage = (message, cleanMessage) => {
        const currentTime = Date.now();
        const results = chrono.parse(cleanMessage, currentTime, { forwardDate: true });
        if (results.length === 0) {
            return { error: EventErrors.DateParse };
        }

        const text = message.replace(results[0].text, "").trim();
        const cleanText = cleanMessage.replace(results[0].text, "").trim();
        const date = results[0].date()

        if (date <= currentTime) {
            return { error: EventErrors.EventInPast };
        }

        return { cleanText: cleanText, text: text, date: date };
    }

    // Create a new event based on a message with args
    newEvent = (message) => {
        const messageText = message.content.replace(`${config.PREFIX}event `, "")
        const cleanMessage = message.cleanContent.replace(`${config.PREFIX}event `, "")
        const parsedEvent = this.parseEventMessage(messageText, cleanMessage);

        if (parsedEvent.error) {
            message.reply(parsedEvent.error)
            return
        }
        const { cleanText, text, date } = parsedEvent;

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

    updateEvent = async (message) => {
        const idMatch = message.content.match("[#]?([0-9]+)")
        if (!idMatch) {
            message.reply(EventErrors.UnknownEvent)
            return
        }
        const updateRe = new RegExp(`${config.PREFIX}update|${idMatch[0]}`, "g")
        const messageText = message.content.replace(updateRe, "")
        const cleanMessage = message.cleanContent.replace(updateRe, "")
        const parsedEvent = this.parseEventMessage(messageText, cleanMessage);

        if (parsedEvent.error) {
            message.reply(parsedEvent.error)
            return
        }

        const { cleanText, text, date } = parsedEvent;

        const e = await Event.findByPk(parseInt(idMatch[1]))
        if (message.author.id === e.owner_id) {
            // Update the DB
            e.text = text
            e.clean_text = cleanText
            e.date = date
            await e.save()

            // Schedule the new event
            const job = schedule.scheduleJob(e.date, () => { this.notify(e.message_id) })
            e.job = job

            // omg this is horrible
            // Cancel the current event
            let event = this.events[e.message_id]
            if (event.job) {
                event.job.cancel()
            }
            // Remove the old event
            delete this.events[e.message_id]
            // Take the new updated event and assign it
            this.events[e.message_id] = e
            // Rebuild the message and edit it
            this.discordClient.channels.fetch(e.channel_id)
                .then(channel => {
                    channel.messages.fetch(e.message_id, true, true)
                        .then(message => {
                            return message.reactions.cache.get(config.YES_EMOJI).users.fetch()
                                .then(attendees => {
                                    return message.reactions.cache.get(config.NO_EMOJI).users.fetch()
                                        .then(unavail_users => {
                                            const attending = attendees.filter(user => !user.bot).array().join(", ")
                                            const unavail = unavail_users.filter(user => !user.bot).array().join(", ");
                                            return message.edit(eventMessage(e, attending, unavail));
                                        })
                                })
                        })
                        .catch(console.error);
                })
                .then( () => {
                    message.reply(`Updated event #${idMatch[1]}: ${e.getUrl()}`)
                })
                .catch(console.error);
        } else {
            message.reply(EventErrors.PermissionDenied)
        }
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

    getLink = async (message, args) => {
        const id = args.join().match("[0-9]+")
        if (!message.channel.guild) {
            message.reply(`Couldn't find an event with id #${id}`)
        }
        try {
            const e = await Event.findByPk(parseInt(id))
            if (e) {
                if (e.guild_id != message.channel.guild.id) {
                    message.reply(`Couldn't find an event with id #${id}`)
                } else {
                    message.reply(`${e.clean_text}: ${e.getUrl()}`)
                }
            } else {
                message.reply(`Couldn't find an event with id #${id}`)
            }
        } catch {
            message.reply(`Couldn't find a valid id in ${args}`)
        }
    }

}

export { EventManager };
