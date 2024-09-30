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
  let count = 0;

  leaderboardData.forEach((row) => {
    if (count < 7 ) {
      console.log(row);
      let teamName = row['Team Name '];
      let teamPoints = row['Points '];
      let teamCaptain = row['Team Captain '];
      let teamCoCaptain = row['Team Co-Captain '];
      let teamPercentage = row['Board Completion % '];

      leaderboardArray.push({
        teamName: teamName + " - " + teamCaptain + " & " + teamCoCaptain,
        Points: teamPoints + " Points - " + formatPercentage(teamPercentage) + " Completed",
      });
      count++;
    }
  });

  return leaderboardArray;
}

function formatPercentage(number) {
  return number === 0 ? '0.00%' : number.toFixed(2) + '%';
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
    .setTitle('Iron Clan - Autumn Bingo 2024')
    .setDescription('Public Leaderboard: https://shorturl.at/lYQtr\nLast Updated: ' + formattedDateTime)
    .setThumbnail('https://i.imgur.com/i59D7Uy.png')
    .setFooter({ text : 'Made by: JStudders'});

  let sortedTeams = await sortTeams(Leaderboard);

  async.forEach(sortedTeams, async (row) => {
    if (row.Points == undefined) {
      row.Points = 'Error fetching points.';
    } else {
      row.Points = row.Points;
    }

    embed.addFields({
        "name": row.Points,
        "value": row.teamName
      });
  })

  let channel = client.channels.cache.get(process.env.discordChannelId);
  channel.send({ embeds: [embed] });
}

/*
Iron Clan
discordServerId=296396357231575041
discordChannelId=1290321511122735244

Dev
discordServerId=1011360326593298513
discordChannelId=1218327027799560233
*/

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