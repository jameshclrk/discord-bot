import Discord from "discord.js";

import config from "./config.js";
import { EventManager } from "./events.js";

const client = new Discord.Client({ partials: ['MESSAGE', 'CHANNEL', 'REACTION'] });
const eventManager = new EventManager(client);

client.login(config.BOT_TOKEN);

client.once('ready', () => {
    // Once we're connected to discord, load the saved events and schedule them
    eventManager.init()
});

client.on("message", function (message) {
    // Ignore all messages from bots
    if (message.author.bot) return;
    // Ignore messages that don't begin with the prefix
    if (!message.content.startsWith(config.PREFIX)) return;

    // Remove the prefix and get the first argument as the command
    const commandBody = message.content.slice(config.PREFIX.length);
    const args = commandBody.split(' ');
    const command = args.shift().toLowerCase();

    if (command === "list") {
        eventManager.listEvents(message)
    }

    if (command === "event") {
        eventManager.newEvent(message, args)
    }
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
