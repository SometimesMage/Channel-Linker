//Start SQLite
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbFile = './sqlite.db';
const exists = fs.existsSync(dbFile);
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  if(!exists) {
    db.run('CREATE TABLE ChannelLink (send_channel_id TEXT, receive_channel_id TEXT)');
    db.run('CREATE TABLE MessageLink (send_message_id TEXT, receive_message_id TEXT, receive_channel_id TEXT)');
    console.log('Tables Created');
  } else {
    db.run('DROP TABLE MessageLink'); //Discord.js doesn't track message updates/deletes to messages sent before login
    db.run('CREATE TABLE MessageLink (send_message_id TEXT, receive_message_id TEXT, receive_channel_id TEXT)');
  }
});

//Start Up Bot

const Discord = require('discord.js');
const client = new Discord.Client();

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
  if(msg.author.id === client.user.id) {
    return;
  }

  if(msg.content === '!ping') {
    msg.reply('Pong!'); 
  }else if(msg.content.startsWith('!read')) {
    onReadCommand(msg);
  } else if(msg.content.startsWith('!unlink')) {
    onUnlinkCommand(msg);
  } else {
    onMessage(msg);   
  }
});

client.on('messageDelete', msg => {
  if(msg.author.id === client.user.id) {
    return;
  }

  db.serialize(() => {
    let stmt = db.prepare('SELECT receive_message_id as msgId, receive_channel_id channelId FROM MessageLink WHERE send_message_id = ?');
    stmt.each(msg.id, (err, row) => {
      if(client.channels.has(row.channelId)) {
        let channel = client.channels.get(row.channelId);
        channel.fetchMessage(row.msgId)
          .then(sentMsg => sentMsg.delete());
      }
    });
    stmt.finalize();

    stmt = db.prepare('DELETE FROM MessageLink WHERE send_message_id = ?');
    stmt.run(msg.id);
    stmt.finalize();
  });
});

client.on('messageUpdate', (oldMsg, newMsg) => {
  if(msg.author.id === client.user.id) {
    return;
  }

  db.serialize(() => {
    let stmt = db.prepare('SELECT receive_message_id as msgId, receive_channel_id channelId FROM MessageLink WHERE send_message_id = ?');
    stmt.each(oldMsg.id, (err, row) => {
      if(client.channels.has(row.channelId)) {
        let channel = client.channels.get(row.channelId);
        channel.fetchMessage(row.msgId)
          .then(sentMsg => sentMsg.edit(newMsg.content));
      }
    });
    stmt.finalize();
  });
});

//Handle linking a channel
function onReadCommand(msg) {
  let parts = msg.content.split(' ');
  
  if(parts.length < 2) {
    msg.reply('Please include the channel id you want to receive messages from.');
    return;
  }
  
  let channelId = parts[1];
  
  if(!client.channels.has(channelId)) {
    msg.reply('Please input a valid channel id and make sure I am on that server has well!');
    return;
  }
  
  if(channelId === msg.channel.id) {
    msg.reply('An channel can\'t be linked to itself!');
    return;
  }

  db.serialize(() => {
    let stmt = db.prepare('INSERT INTO ChannelLink VALUES (?, ?)');
    stmt.run(channelId, msg.channel.id);
    stmt.finalize();
  });
  
  msg.reply('Channel link added!');
}

//Handle unlinking a channel
function onUnlinkCommand(msg) {
  let parts = msg.content.split(' ');
  
  if(parts.length < 2) {
    msg.reply('Please include the channel id you want to unlink from.');
    return;
  }
  
  let channelId = parts[1];
  
  if(!client.channels.has(channelId)) {
    msg.reply('Please input a valid channel id and make sure I am on that server has well!');
    return;
  }
  
  if(channelId === msg.channel.id) {
    msg.reply('An channel can\'t be linked to itself!');
    return;
  }

  db.serialize(() => {
    let stmt = db.prepare('DELETE FROM ChannelLink WHERE send_channel_id = ? AND receive_channel_id = ?');
    stmt.run(channelId, msg.channel.id);
    stmt.finalize();
  });
  
  msg.reply('Channel unlinked!');
}

//Handle dispatching messages to links
function onMessage(msg) {
  db.serialize(() => {
    let stmt = db.prepare('SELECT receive_channel_id as id FROM ChannelLink WHERE send_channel_id = ?');
    stmt.each(msg.channel.id, (err, row) => {
      if(client.channels.has(row.id)) {
        let channel = client.channels.get(row.id);
        sendMessageCopy(msg, channel);       
      }
    });
    stmt.finalize();
  });
}

function sendMessageCopy(msg, channel) {
  let guildName = msg.channel.guild ? msg.channel.guild.name : 'DM';
  let channelName = msg.channel.name ? msg.channel.name : 'Unknown';
  let authorName = msg.author.username;

  const embed = new Discord.RichEmbed()
      .setTitle('Message Meta Data')
      .setColor(0x364FF5)
      .setThumbnail(msg.author.displayAvatarURL)
      .addField('Server', guildName, true)
      .addField('Channel', channelName, true)
      .addField('Author', authorName, true);

  let attachments = [];

  for(let entry of msg.attachments.entries()) {
    let attachment = new Discord.Attachment(entry[1].url, entry[1].filename);
    attachments.push(attachment);
  }
  
  channel.send(msg.content, {files: attachments, embed: embed})
    .then(sentMsg => {
      db.serialize(() => {
        let stmt = db.prepare('INSERT INTO MessageLink VALUES (?, ?, ?)');
        stmt.run(msg.id, sentMsg.id, channel.id);
        stmt.finalize();
      });
    })
    .catch(err => console.error(err));
}

client.login(require('./config').token);