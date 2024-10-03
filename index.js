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
        teamName: "`" + teamName + "` - " + teamCaptain + " & " + teamCoCaptain,
        Points: checkPoints(teamPoints) + " Points - " + formatPercentage(teamPercentage) + " Completed",
      });
      count++;
    }
  });

  return leaderboardArray;
}

function formatPercentage(number) {
  if (number == undefined) {
    return 'N/A'
  }
  return number === 0 ? '0.00%' : number.toFixed(2) + '%';
}

function checkPoints(number) {
  if (number == undefined) {
    return 'N/A'
  } else {
    return number
  }
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
    .setFooter({ text : 'Leaderboard updates every hour\nMute channel to hide notifications\nMade by: JStudders'});

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
  // Helper function to extract the numeric part (X) from "X Points - Y.YY% Completed"
  function extractPoints(pointsString) {
    if (!pointsString || pointsString === "N/A") return undefined;  // Handle undefined and "N/A"
    const pointsMatch = pointsString.match(/^(\d+)/);  // Match the number at the start
    return pointsMatch ? parseInt(pointsMatch[1], 10) : undefined;
  }

  // Function to compare two teams based on their Points
  function compareTeams(a, b) {
    const pointsA = extractPoints(a.Points);
    const pointsB = extractPoints(b.Points);

    if (pointsA === undefined && pointsB === undefined) {
      return 0;
    } else if (pointsA === undefined) {
      return 1;  // a goes after b if a's Points is undefined or "N/A"
    } else if (pointsB === undefined) {
      return -1; // b goes after a if b's Points is undefined or "N/A"
    }
    return pointsB - pointsA; // Sort in descending order
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

function addIcon() {
  let 
}
async function updateLeaderboard() {
  var Leaderboard = await getLeaderboard();
  var lastMessage = await getMessages();
  await sendMessage(Leaderboard);
}                      