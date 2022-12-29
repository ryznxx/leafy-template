require('./data-source/bot-cfg')
const { default: ryznxxConnect, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateForwardMessageContent, prepareWAMessageMedia, generateWAMessageFromContent, generateMessageID, downloadContentFromMessage, makeInMemoryStore, jidDecode, proto, getContentType } = require("@adiwajshing/baileys")
const { state, saveState } = useSingleFileAuthState(`./data-source/${sessionName}.json`)
const pino = require('pino')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const figlet = require('figlet')
const _ = require('lodash')
const yargs = require('yargs/yargs')
const FileType = require('file-type')
const path = require('path')
const PhoneNumber = require('awesome-phonenumber')
const { smsg } = require('./lib/system-func')

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })

const color = (text, color) => {
    return !color ? chalk.green(text) : chalk.keyword(color)(text)
}

var low
try {
	low = require('lowdb')
} catch (e) {
	low = require('./lib/lowdb')
}

const { Low, JSONFile } = low
const mongoDB = require('./lib/mongoDB')

global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse())
global.db = new Low(/https?:\/\//.test(opts['db'] || '') ? new cloudDBAdapter(opts['db']) : /mongodb/.test(opts['db']) ?
			new mongoDB(opts['db']) :
			new JSONFile(`data-source/database.json`)
)
global.DATABASE = global.db

global.loadDatabase = async function loadDatabase() {
	if (global.db.READ) return new Promise((resolve) => setInterval(function () { (!global.db.READ ? (clearInterval(this), resolve(global.db.data == null ? global.loadDatabase() : global.db.data)) : null) }, 1 * 1000))
	if (global.db.data !== null) return
	global.db.READ = true
	await global.db.read()
	global.db.READ = false
	global.db.data = {
		users: {},
		chats: {},
		database: {},
		settings: {},
		others: {},
    ...(global.db.data || {})
  }
  global.db.chain = _.chain(global.db.data)
}
loadDatabase()

if (global.db) setInterval(async () => {
	if (global.db.data) await global.db.write()
}, 30 * 1000)


async function startConnection() {
    const { version, isLatest } = await fetchLatestBaileysVersion()
    console.log(color(figlet.textSync('Template', {
		font: 'Standard',
		horizontalLayout: 'center',
		vertivalLayout: 'default',
		whitespaceBreak: false
	}), 'white'))

    const client = ryznxxConnect({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: ['Leafyx-connect', 'Safari', '1.0.0'],
        auth: state
    })
    
    
    store.bind(client.ev)

    client.ev.on('messages.upsert', async chatUpdate => {
        //console.log(JSON.stringify(chatUpdate, undefined, 2))
        try {
            mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return
            if (!client.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
            m = smsg(client, mek, store)
            require("./handler")(client, m, chatUpdate, store)
            if (mek.message.buttonsResponseMessage?.selectedButtonId) { return m } 
        } catch (err) {
            console.log(err)
        }
    })
	
    // Handle error
    const unhandledRejections = new Map()
    process.on('unhandledRejection', (reason, promise) => {
        unhandledRejections.set(promise, reason)
        console.log('Unhandled Rejection at:', promise, 'reason:', reason)
    })
    process.on('rejectionHandled', (promise) => {
        unhandledRejections.delete(promise)
    })
    process.on('Something went wrong', function(err) {
        console.log('Caught exception: ', err)
    })
    
    // Setting
    client.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }
    
    client.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = client.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    client.getName = (jid, withoutContact  = false) => {
        id = client.decodeJid(jid)
        withoutContact = client.withoutContact || withoutContact 
        let v
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = client.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === client.decodeJid(client.user.id) ?
        client.user :
            (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }
    
    client.setStatus = (status) => {
        client.query({
            tag: 'iq',
            attrs: {
                to: '@s.whatsapp.net',
                type: 'set',
                xmlns: 'status',
            },
            content: [{
                tag: 'status',
                attrs: {},
                content: Buffer.from(status, 'utf-8')
            }]
        })
        return status
    }
	
    client.public = true

    client.serializeM = (m) => smsg(client, m, store)
    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update	    
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode
            if (reason === DisconnectReason.badSession) { console.log(`Bad Session File, Please Delete Session and Scan Again`); process.exit(); }
            else if (reason === DisconnectReason.connectionClosed) { console.log("Connection closed, reconnecting...."); startConnection(); } 
            else if (reason === DisconnectReason.connectionLost) { console.log("Connection Lost from Server, reconnecting..."); startConnection(); }
            else if (reason === DisconnectReason.connectionReplaced) { console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First"); process.exit(); }
            else if (reason === DisconnectReason.loggedOut) { console.log(`Device Logged Out, Please Delete Session file session.json and Scan Again.`); process.exit(); }
            else if (reason === DisconnectReason.restartRequired) { console.log("Restart Required, Restarting..."); startConnection(); }
            else if (reason === DisconnectReason.timedOut) { console.log("Connection TimedOut, Reconnecting..."); startConnection(); }
            else { console.log(`Unknown DisconnectReason: ${reason}|${connection}`); startConnection(); }
        } else if(connection === 'open') {
            console.log('Bot conneted to server')
        }
    })

    client.ev.on('creds.update', saveState)

    client.sendText = (jid, text, quoted = '', options) => client.sendMessage(jid, { text: text, ...options }, { quoted })

    client.cMod = (jid, copy, text = '', sender = client.user.id, options = {}) => {
		let mtype = Object.keys(copy.message)[0]
		let isEphemeral = mtype === 'ephemeralMessage'
        if (isEphemeral) {
            mtype = Object.keys(copy.message.ephemeralMessage.message)[0]
        }
        let msg = isEphemeral ? copy.message.ephemeralMessage.message : copy.message
		let content = msg[mtype]
        if (typeof content === 'string') msg[mtype] = text || content
		else if (content.caption) content.caption = text || content.caption
		else if (content.text) content.text = text || content.text
		if (typeof content !== 'string') msg[mtype] = {
			...content,
			...options
        }
        if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant
		else if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant
		if (copy.key.remoteJid.includes('@s.whatsapp.net')) sender = sender || copy.key.remoteJid
		else if (copy.key.remoteJid.includes('@broadcast')) sender = sender || copy.key.remoteJid
		copy.key.remoteJid = jid
		copy.key.fromMe = sender === client.user.id

        return proto.WebMessageInfo.fromObject(copy)
    }
    
    client.sendButtonText = (jid, buttons = [], text, footer, quoted = '', options = {}) => {
        let buttonMessage = {
            text,
            footer,
            buttons,
            headerType: 2,
            ...options
        }
        client.sendMessage(jid, buttonMessage, { quoted, ...options })
    }
    
    client.sendListMsg = (jid, text = '', footer = '', title = '' , butText = '', sects = [], quoted) => {
        let sections = sects
        var listMes = {
        	text: text,
        	footer: footer,
        	title: title,
        	buttonText: butText,
        	sections
        }
        client.sendMessage(jid, listMes, { quoted: quoted })
    }
    

    return client
}

startConnection()


let file = require.resolve(__filename)
fs.watchFile(file, () => {
	fs.unwatchFile(file)
	console.log(chalk.redBright(`Update ${__filename}`))
	delete require.cache[file]
	require(file)
})
