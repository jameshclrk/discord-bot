import chrono from 'chrono-node';
import schedule from 'node-schedule';
import { eventMessage, notificationMessage } from "./responses.js";
import Sequelize from 'sequelize';
import config from "./config.js";

const modelOptions = {
    message_id: {
        type: Sequelize.STRING,
        unique: true,
    },
    owner_id: Sequelize.STRING,
    channel_id: Sequelize.STRING,
    args: Sequelize.TEXT,
    date: Sequelize.DATE,
};

class EventManager {
    constructor(sequelize, client) {
        this.events = {};
        this.sequelize = sequelize;
        this.discordClient = client;
        this.model = this.sequelize.define('events', modelOptions);
    }

    // Initialise the database model and add add existing events to runtime
    init = () => {
        this.model.sync();
        this.model.findAll()
            .then(allEvents => {
                allEvents.forEach(e => {
                    this.addEvent(e)
                    console.log(`loaded event ${e.message_id} from database`)
                })
            });
    }

    // Send a notification message for an event
    notify = (messageId) => {
        const event = this.events[messageId];
        this.discordClient.channels.fetch(event.channel_id)
            .then(channel => {
                channel.messages.fetch(messageId, true, true)
                    .then(message => message.reactions.cache.get(config.YES_EMOJI).users.fetch())
                    .then(users => {
                        console.log(`event ${messageId} happened! deleting`)
                        const attending = users.filter(user => !user.bot).array().join(", ");
                        return channel.send(notificationMessage(event.args, null, attending))
                    })
                    .then(() => this.deleteEvent(event.owner_id, messageId))
                    .catch(console.error);
            })
            .catch(console.error);
    }

    // Add event to the job scheduler
    addEvent = dbEvent => {
        const job = schedule.scheduleJob(dbEvent.date, () => { this.notify(dbEvent.message_id) })
        this.events[dbEvent.message_id] = {
            "job": job,
            "owner_id": dbEvent.owner_id,
            "channel_id": dbEvent.channel_id,
            "args": dbEvent.args,
            "date": dbEvent.date,
        }
    }

    // Store event in the database
    storeEvent = async (messageId, authorId, channelId, arg, date) => {
        return await this.model.create({
            "message_id": messageId,
            "owner_id": authorId,
            "channel_id": channelId,
            "args": arg,
            "date": date,
        });
    }

    // Create a new event based on a message with args
    newEvent = (message, args) => {
        // For an event, we want to take the other arguments as a sentence
        const arg = args.join(" ")
        const currentTime = Date.now()
        const results = chrono.parse(arg, currentTime, { forwardDate: true });

        // Check if the parsing was successful
        if (results.length === 0) {
            message.reply("Couldn't parse the event date/time ¯\\_(ツ)_/¯")
            return
        }

        const text = arg.replace(results[0].text, '');
        const date = results[0].date()

        if (date <= currentTime) {
            message.reply("Events should be in the future ¯\\_(ツ)_/¯")
            return
        }

        message.reply(eventMessage(text, date, ""))
            .then((newMessage) => {
                newMessage.react(config.YES_EMOJI);
                newMessage.react(config.EXIT_EMOJI);
                console.log(`${message.author.username} created event ${message.id}`);
                return this.storeEvent(newMessage.id, message.author.id, newMessage.channel.id, text, date);
            })
            .then(e => this.addEvent(e))
            .catch(console.error);
    }

    // Remove an event from runtime and database
    deleteEvent = async (userId, admin, messageId) => {
        if (admin || userId === this.events[messageId].owner_id) {
            const job = this.events[messageId].job
            if (job) {
                job.cancel()
            }
            this.discordClient.channels.fetch(this.events[messageId].channel_id)
                .then(channel => channel.messages.fetch(messageId))
                .then(message => message.delete())
                .catch(console.error)
            delete this.events[messageId]
            await this.model.destroy({ where: { message_id: messageId } });
        }
    }

    // Check if a message is an event
    isEvent = (messageId) => {
        return messageId in this.events
    }

    // Handle event reactions
    handleReaction = (messageReaction, user, action) => {
        if (messageReaction._emoji.name === config.YES_EMOJI) {
            console.log(`${user.username} joined event ${messageReaction.message.id}`)
            this.updateAttendees(messageReaction);
        } else if ((action === "add") && (messageReaction._emoji.name === config.EXIT_EMOJI)) {
            const guild = messageReaction.message.guild;
            let admin = false;
            if (guild) {
                admin = guild.member(user).hasPermission('ADMINISTRATOR')
            }
            this.deleteEvent(user.id, admin, messageReaction.message.id)
                .then(() => {
                    console.log(`${user.username} deleted event ${messageReaction.message.id}`);
                })
                .catch(console.error)
        }
    }

    // Update the attendee list when a message has a new reaction
    updateAttendees = (messageReaction) => {
        messageReaction.message.reactions.cache.get(config.YES_EMOJI).users.fetch()
            .then(users => {
                const attending = users.filter(user => !user.bot).array().join(", ");
                const e = this.events[messageReaction.message.id];
                return messageReaction.message.edit(eventMessage(e.args, e.date, attending));
            })
            .catch(console.error);
    }
}

export { EventManager };