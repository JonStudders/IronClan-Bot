require('dotenv').config()

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const PublicGoogleSheetsParser = require('public-google-sheets-parser');
const async = require('async');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const spreadsheetId  = process.env.sheetId;
const options = { sheetName: 'Leaderboard' }
const parser = new PublicGoogleSheetsParser(spreadsheetId, options);


client.on('ready', async () => {
    console.log("Iron Clan bot is online.");
    runHourly();
})

client.login(process.env.botToken)


async function getLeaderboard() {
  let leaderboardData = await parser.parse().then((data) => {
    return data;
  });

  let leaderboardArray = [];

  leaderboardData.forEach((row) => {
    teamName = row['Input your team name here: '];
    teamPoints = row.Points;
    leaderboardArray.push({
      teamName: teamName,
      Points: teamPoints
    });
  });

  return leaderboardArray;
}

function runHourly() {
  updateLeaderboard()
      .then(() => {// 60 60
          setTimeout(runHourly,10 * 60 * 1000);
      })
      .catch(error => {
          console.error("An error occurred:", error);
          // 60
          setTimeout(runHourly,60 * 1000);
      });
}

async function getMessages() {
  await client.channels.cache.clear();
  let channel = await client.channels.fetch(process.env.discordChannelId);
  if (channel.lastMessageId === null) {
    return null;
  } else {
    try {
      let message = await channel.messages.fetch(channel.lastMessageId);
      message.delete()
      return message; // Return message from .then() block
    } catch (error) {
      return null; // Return null from .catch() block
    }
  }
}

async function sendMessage(Leaderboard) {
  let formattedDateTime = await getCurrentDatetime();
  let embed = new EmbedBuilder()
    .setColor('#d129c9')
    .setTitle('Iron Clan - Spring Bingo 2024')
    .setDescription('Leaderboard Ranking - ' + formattedDateTime)
    .setThumbnail('https://i.imgur.com/zRfuj6T.png')
    .setFooter({ text : 'Made by: blancuh'});

  let sortedTeams = await sortTeams(Leaderboard);

  async.forEach(sortedTeams, async (row) => {
    if (row.Points == undefined) {
      row.Points = 'Error fetching points.';
    } else {
      row.Points = row.Points + ' Points';
    }

    embed.addFields({
        "name": row.Points + ' Points',
        "value": row.teamName
      });
  })

  let channel = client.channels.cache.get(process.env.discordChannelId);
  channel.send({ embeds: [embed] });
}

async function sortTeams(Leaderboard) {
  // Move undefined values to the bottom
  function compareTeams(a, b) {
    if (a.Points === undefined && b.Points === undefined) {
      return 0;
    } else if (a.Points === undefined) {
      return 1;
    } else if (b.Points === undefined) {
      return -1;
    }
    return b.Points - a.Points;
  }

  Leaderboard.sort(compareTeams);
  return Leaderboard;
}

async function getCurrentDatetime() {
  let currentDate = new Date();
  let day = String(currentDate.getDate()).padStart(2, '0');
  let month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Months are zero based
  let year = currentDate.getFullYear();
  let hours = String(currentDate.getHours()).padStart(2, '0');
  let minutes = String(currentDate.getMinutes()).padStart(2, '0');
  
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

async function updateLeaderboard() {
  var Leaderboard = await getLeaderboard();
  var lastMessage = await getMessages();
  await sendMessage(Leaderboard);
}                      