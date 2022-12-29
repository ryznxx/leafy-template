const fs = require('fs')
const chalk = require('chalk')

global.sessionName = 'session'
global.leafyx = 'leafyx on whatsapp'
global.owner = [''] // isi nomermu
global.premium = [''] // isi nomer mu aja
global.prefa = ['','!','.']
global.limitawal = {
    premium: "Infinity",
    free: 20
}

global.specialText = '```'

let file = require.resolve(__filename)
fs.watchFile(file, () => {
	fs.unwatchFile(file)
	console.log(chalk.redBright(`Update'${__filename}'`))
	delete require.cache[file]
	require(file)
})
