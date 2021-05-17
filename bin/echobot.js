"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const Discord = require("discord.js");
const winston = require("winston");
const discord_js_1 = require("discord.js");
const http = require("http");
const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "svg", "jif", "jfif", "apng"];
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(info => {
        return `${info.timestamp} [${info.level.toLocaleUpperCase()}]: ${info.message}`;
    })),
    transports: new winston.transports.Console()
});
let config = null;
let discordClient = null;
class EchoBot {
    constructor() {
        if (!this.loadConfiguration())
            return;
        this.startWebServer();
        this.loginToDiscord();
    }
    loadConfiguration() {
        if (fs.existsSync("config.json")) {
            config = JSON.parse(fs.readFileSync("config.json").toString());
        }
        else if (process.env.ECHOBOT_CONFIG_JSON) {
            config = JSON.parse(process.env.ECHOBOT_CONFIG_JSON);
        }
        else {
            logger.error("No configuration could be found. Either create a config.json file or put the config in the ECHOBOT_CONFIG_JSON environment variable.");
            return false;
        }
        if (!config.token) {
            logger.error("The Discord Client token is missing from the configuration file.");
            return false;
        }
        if (!config.redirects) {
            logger.error("You have not defined any redirects. This bot is useless without them.");
            return false;
        }
        else if (!Array.isArray(config.redirects)) {
            logger.error("The redirects are not properly formatted (missing array). Please check your configuration.");
            return false;
        }
        else if (config.redirects.length == 0) {
            logger.error("You have not defined any redirects. This bot is useless without them.");
            return false;
        }
        else {
            for (let redirect of config.redirects) {
                if (!redirect.sources || redirect.sources.length == 0) {
                    logger.error("A redirect has no sources.");
                    return false;
                }
                else if (!Array.isArray(redirect.sources)) {
                    logger.error("A redirect's sources were not formatted as an array.");
                    return false;
                }
                if (!redirect.destinations || redirect.destinations.length == 0) {
                    logger.error("A redirect has no destinations.");
                    return false;
                }
                else if (!Array.isArray(redirect.destinations)) {
                    logger.error("A redirect's destinations were not formatted as an array.");
                    return false;
                }
                for (let source of redirect.sources) {
                    for (let destination of redirect.destinations) {
                        if (source == destination) {
                            logger.error("A redirect has a source that is the same as a destination: " + source + ". This will result in an infinite loop.");
                            return false;
                        }
                    }
                }
            }
        }
        logger.info("Configuration loaded successfully.");
        return true;
    }
    startWebServer() {
        if (!process.env.PORT || isNaN(Number.parseInt(process.env.PORT)))
            return;
        logger.info("Starting web server on port " + process.env.PORT);
        http.createServer((req, res) => {
            res.write("pong");
            res.end();
        }).listen(process.env.PORT);
    }
    loginToDiscord() {
        discordClient = new Discord.Client();
        discordClient.on('ready', () => {
            logger.info("Signed into Discord.");
        });
        discordClient.on('message', (message) => {
            this.onDiscordClientMessageReceived(message)
                .then(() => logger['debug']("Message handled gracefully."))
                .catch(err => {
                logger.error("Failed to handle message:");
                logger.error(err);
            });
        });
        discordClient.on('error', error => {
            logger.error("An error occurred: " + error.message);
            logger.info("Restarting Discord Client.");
            discordClient.destroy();
            this.loginToDiscord();
        });
        discordClient
            .login(config.token)
            .catch(err => {
            logger.error("Could not sign into Discord:", err);
        });
    }
    onDiscordClientMessageReceived(message) {
        return __awaiter(this, void 0, void 0, function* () {
            let matchingRedirects = config.redirects.filter(redirect => redirect.sources.some(source => source == message.channel.id));
            for (let redirect of matchingRedirects) {
                if (redirect.options && redirect.options.allowList) {
                    if (redirect.options.allowList.length > 0) {
                        if (!redirect.options.allowList.includes(message.author.id)) {
                            logger.info("Dropping message from " + message.author.username + " in " + message.guild.name + "/" + message.channel.name + " as their ID (" + message.author.id + ") is not in the allowList.");
                            continue;
                        }
                    }
                }
                let header = this.createHeader(message, redirect);
                let body = this.createBody(message, redirect);
                if (redirect.options && redirect.options.minLength) {
                    if (!body.embed && (!body.contents || body.contents.length < redirect.options.minLength)) {
                        logger.info(`Dropping message from ${message.author.username} in ${this.explainPath(message.channel)} as their message is too short.`);
                        continue;
                    }
                }
                if (!body.contents && !body.embed) {
                    logger.info(`Dropping message from ${message.author.username} in ${this.explainPath(message.channel)} as their message would be empty due to redirect options.`);
                    continue;
                }
                for (let destination of redirect.destinations) {
                    let destChannel = discordClient.channels.get(destination);
                    if (destChannel == null) {
                        Promise.reject(`Could not redirect from channel ID ${message.channel.id} to channel ID ${destination}: Destination channel was not found.`);
                        return;
                    }
                    else if (!(destChannel instanceof discord_js_1.TextChannel)) {
                        Promise.reject(`Could not redirect from channel ID ${message.channel.id} to channel ID ${destination}: Destination channel is not a text channel.`);
                        return;
                    }
                    logger.info(`Redirecting message by ${message.author.username} from ${this.explainPath(message.channel)} to ${this.explainPath(destChannel)}`);
                    if (header) {
                        logger.debug("Sending header:");
                        logger.debug(JSON.stringify(header));
                        let options = {
                            nonce: this.generateNonce()
                        };
                        if (header instanceof Discord.RichEmbed) {
                            options.embed = header;
                            yield destChannel.send(options);
                            logger.debug("Sent header as embed.");
                        }
                        else {
                            yield destChannel.send(header, options);
                            logger.debug("Sent header as text.");
                        }
                    }
                    logger['debug']("Sending body:");
                    logger.debug(JSON.stringify(body));
                    let options = {
                        nonce: this.generateNonce(),
                        files: redirect.options.copyAttachments ? message.attachments.map(attachment => {
                            return new Discord.Attachment(attachment.url, attachment.filename);
                        }) : [],
                        embed: body.embed
                    };
                    yield destChannel.send(body.contents, options);
                    logger.debug("Sent body.");
                }
            }
        });
    }
    explainPath(channel) {
        let parts = [];
        if (channel instanceof Discord.GuildChannel) {
            parts.push(channel.guild.name);
            if (channel.parent) {
                parts.push(channel.parent.name);
            }
            parts.push(channel.name);
        }
        else if (channel instanceof Discord.DMChannel) {
            parts.push(`Direct Messages`);
        }
        return parts.join("/");
    }
    createHeader(message, redirect) {
        if (redirect.options && redirect.options.richEmbed) {
            let richEmbed = new Discord.RichEmbed({
                color: redirect.options.richEmbedColor ? redirect.options.richEmbedColor : 30975
            });
            if (!redirect.options.title && !redirect.options.includeSource) {
                return null;
            }
            if (redirect.options.title) {
                richEmbed.setTitle(redirect.options.title);
            }
            if (redirect.options.includeSource) {
                richEmbed.addField("Author", `**${message.member.displayName}** in **${this.explainPath(message.channel)}**`);
            }
            return richEmbed;
        }
        else {
            let destinationMessage = "";
            if (redirect.options && redirect.options.title) {
                destinationMessage += "**" + redirect.options.title + "**\n";
            }
            if (redirect.options && redirect.options.includeSource) {
                destinationMessage += `*Author: **${message.member.displayName}** in **${this.explainPath(message.channel)}***\n`;
            }
            if (destinationMessage == "") {
                return null;
            }
            return destinationMessage;
        }
    }
    createBody(message, redirect) {
        let contents = message.content;
        let embed = undefined;
        if (redirect.options && redirect.options.copyRichEmbed) {
            let receivedEmbed = message.embeds.find(e => e.type == 'rich');
            if (receivedEmbed) {
                embed = new Discord.RichEmbed(receivedEmbed);
            }
        }
        if (redirect.options && redirect.options.removeEveryone)
            contents = contents.replace("@everyone", "");
        if (redirect.options && redirect.options.removeHere)
            contents = contents.replace("@here", "");
        return { contents, embed };
    }
    generateNonce() {
        let nonce = Math.round(Math.random() * Math.floor(Number.MAX_SAFE_INTEGER / 10)).toString();
        logger.debug("Nonce: " + nonce);
        return nonce;
    }
}
new EchoBot();
//# sourceMappingURL=echobot.js.map