import Discord from "discord.js";

import config from "./config.js";
import { EventManager } from "./events.js";

const client = new Discord.Client({ partials: ['MESSAGE', 'CHANNEL', 'REACTION'] });
const eventManager = new EventManager(client);


client.once('ready', () => {
    // Once we're connected to discord, load the saved events and schedule them
    eventManager.init()
});

client.on("guildCreate", function(guild) {
    const required_permissions = [
        "MANAGE_MESSAGES",       // Remove reactions (always), Remove messages (when moderating)
        "ADD_REACTIONS",         // Add voting options as reactions
        "VIEW_CHANNEL",          // View messages to create events
        "SEND_MESSAGES",         // Send event details/reminders
        "READ_MESSAGE_HISTORY",  // For handling events after the bot has restarted
        "MENTION_EVERYONE",      // In case someone wants to mention everyone
    ]
    console.log(`Bot joined ${guild.id}`)
    required_permissions.map((permission) => {
        if (!guild.me.hasPermission(permission)) {
            console.log(`MISSING PERMISSION IN ${guild.name}: ${permission}`)
        }
    })
})

client.on("message", function (message) {
    eventManager.isChannelRegistered(message.channel)
        .then(moderate => {
            // Ignore all messages from bots
            if (message.author.bot) return Promise.resolve();
            // Ignore messages that don't begin with the prefix
            if (!message.content.startsWith(config.PREFIX)) {
                if (moderate) {
                    message.delete()
                }
                return Promise.resolve()
            }

            // Remove the prefix and get the first argument as the command
            const commandBody = message.content.slice(config.PREFIX.length);
            const args = commandBody.split(' ');
            const command = args.shift().toLowerCase();

            if (command === "list") {
                eventManager.listEvents(message)
            } else if (command === "register") {
                eventManager.registerChannel(message, args)
            } else if (command === "unregister") {
                eventManager.unregisterChannel(message, args)
            } else if (command === "event") {
                eventManager.newEvent(message)
            } else if (command === "show") {
                eventManager.getLink(message, args)
            } else if (command === "update") {
                eventManager.updateEvent(message)
            }
            if (moderate) message.delete()
        })
        .catch(console.error)
});

client.on("messageReactionAdd", async (messageReaction, user) => {
    if (messageReaction.message.partial) await messageReaction.message.fetch();
    if (user.bot) return;
    if (messageReaction.me) return;
    if (eventManager.isEvent(messageReaction.message.id)) {
        eventManager.handleReaction(messageReaction, user, "add")
    }
});

client.on("messageReactionRemove", async (messageReaction, user) => {
    if (messageReaction.message.partial) await messageReaction.message.fetch();
    if (user.bot) return;
    if (messageReaction.me) return;
    if (eventManager.isEvent(messageReaction.message.id)) {
        eventManager.handleReaction(messageReaction, user, "remove")
    }
});

client.login(config.BOT_TOKEN);

process.on('SIGTERM', () => {
    console.info('SIGTERM signal received.');
    client.destroy()
    process.exit(0)
});

