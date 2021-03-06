const
  Discord = require("discord.js"),
  config = require("../config.json"),
  commandHandler = require("./handlers/commands.js"),
  hostingHandler = require("./handlers/hosting.js"),
  client = new Discord.Client({
    disableMentions: "everyone",
    messageCacheLifetime: 30,
    messageSweepInterval: 300,
    partials: [ "USER", "CHANNEL", "GUILD_MEMBER", "MESSAGE", "REACTION" ],
    presence: {
      status: "idle",
      activity: {
        type: "WATCHING",
        name: "the loading screen"
      }
    },
    ws: {
      intents: [ "GUILDS", "GUILD_VOICE_STATES", "GUILD_MESSAGES", "GUILD_MESSAGES", "GUILD_MESSAGE_REACTIONS" ]
    }
  }),
  db = require("./database/index.js");

let shard = "Shard N/A:", disabledGuilds = null;

hostingHandler.configure(client, db);

client.once("shardReady", async (shardid, unavailable = new Set()) => {
  shard = `Shard ${shardid}:`;
  console.log(shard, `Ready as ${client.user.tag}! Caching guilds.`);

  // process guilds
  client.loading = true;
  disabledGuilds = new Set([...Array.from(unavailable), ...client.guilds.cache.map(guild => guild.id)]);
  let cachingStartTimestamp = Date.now();
  await db.cacheGuilds(disabledGuilds);
  console.log(shard, `All ${disabledGuilds.size} guilds have been cached. Processing available guilds. [${Date.now() - cachingStartTimestamp}ms]`);
  let processingStartTimestamp = Date.now(), completed = 0, presenceInterval = setInterval(() => client.user.setPresence({
    status: "idle",
    activity: {
      type: "WATCHING",
      name: `the loading screen (${Math.round((completed / client.guilds.cache.size) * 100)}%)`
    }
  }), 1000);
  for (const guild of Array.from(client.guilds.cache.values())) {
    await processGuild(guild);
    disabledGuilds.delete(guild.id);
    completed++;
  }
  clearInterval(presenceInterval);
  console.log(shard, `All ${client.guilds.cache.size} available guilds have been processed and is now ready! [${Date.now() - processingStartTimestamp}ms]`);
  disabledGuilds = false;
  client.loading = false;

  // update presence
  updatePresence();
  client.setInterval(updatePresence, 60000);
});

function updatePresence() {
  const n = Array.from(hostingHandler.gameStates.keys()).filter(chid => client.channels.resolve(chid)).length;
  return client.user.setPresence({
    status: "online",
    activity: {
      type: "WATCHING",
      name: `${n == 0 ? "the cameras" : `${n} game${n > 1 ? "s" : ""}`} ??? ${config.prefix}help`
    }
  });
}

client.on("message", async message => {
  if (
    !message.guild || // dms
    disabledGuilds == null ||
    (
      disabledGuilds &&
      disabledGuilds.has(message.guild.id)
    ) ||
    message.author.bot ||
    message.type !== "DEFAULT"
  ) return;

  const gdb = await db.guild(message.guild.id);
  let { prefix } = gdb.get();
  if (!prefix.length) prefix = config.prefix;

  if (message.content.startsWith(prefix) || message.content.match(`^<@!?${client.user.id}> `)) return commandHandler(message, gdb, db, prefix);
  else if (message.content.match(`^<@!?${client.user.id}>`)) return message.channel.send(`???? My prefix is \`${prefix}\`, for help type \`${prefix}help\`.`);
});

async function processGuild(guild) {
  const gdb = await db.guild(guild.id), { hostingChannel } = gdb.get();

  // check the hosting panel
  const hChannel = guild.channels.resolve(hostingChannel);
  if (hChannel && hChannel.viewable) await hostingHandler.refreshPanel(hChannel, gdb, guild);
}

client
  .on("error", err => console.log(shard, "Client error.", err))
  .on("rateLimit", rateLimitInfo => console.log(shard, "Rate limited.", JSON.stringify(rateLimitInfo)))
  .on("shardDisconnected", closeEvent => console.log(shard, "Disconnected.", closeEvent))
  .on("shardError", err => console.log(shard, "Error.", err))
  .on("shardReconnecting", () => console.log(shard, "Reconnecting."))
  .on("shardResume", (_, replayedEvents) => console.log(shard, `Resumed. ${replayedEvents} replayed events.`))
  .on("warn", info => console.log(shard, "Warning.", info))
  .login(config.token);