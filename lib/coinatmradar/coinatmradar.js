const axios = require('axios')
const _ = require('lodash/fp')

const db = require('../db')
const configManager = require('../config-manager')
const options = require('../options')

const TIMEOUT = 10000
const MAX_CONTENT_LENGTH = 2000

// How long a machine can be down before it's considered offline
const STALE_INTERVAL = '2 minutes'

module.exports = {update, mapRecord}

function mapCoin (info, deviceId, cryptoCode) {
  const config = info.config
  const rates = info.rates[cryptoCode] || {cashIn: null, cashOut: null}
  const cryptoConfig = configManager.scoped(cryptoCode, deviceId, config)

  return {
    cryptoCode,
    cashInFee: cryptoConfig.cashInCommission / 100,
    cashOutFee: cryptoConfig.cashOutCommission / 100,
    cashInRate: rates.cashIn.toNumber(),
    cashOutRate: rates.cashOut.toNumber()
  }
}

function mapIdentification (info, deviceId) {
  const machineConfig = configManager.machineScoped(deviceId, info.config)

  return {
    isPhone: machineConfig.smsVerificationActive,
    isPalmVein: false,
    isPhoto: false,
    isIdDocScan: machineConfig.idCardDataVerificationActive,
    isFingerprint: false
  }
}

function mapMachine (info, machineRow) {
  const deviceId = machineRow.device_id
  const config = info.config
  const machineConfig = configManager.machineScoped(deviceId, config)

  const lastOnline = machineRow.last_online.toISOString()
  const status = machineRow.stale ? 'online' : 'offline'

  const cashLimit = machineConfig.hardLimitVerificationActive
    ? machineConfig.hardLimitVerificationThreshold
    : Infinity

  const cryptoCurrencies = machineConfig.cryptoCurrencies
  const identification = mapIdentification(info, deviceId)
  const coins = _.map(_.partial(mapCoin, [info, deviceId]), cryptoCurrencies)

  return {
    machineId: deviceId,
    status,
    lastOnline,
    cashIn: true,
    cashOut: machineConfig.cashOutEnabled,
    manufacturer: 'lamassu',
    cashInTxLimit: cashLimit,
    cashOutTxLimit: cashLimit,
    cashInDailyLimit: cashLimit,
    cashOutDailyLimit: cashLimit,
    fiatCurrency: machineConfig.fiatCurrency,
    identification,
    coins
  }
}

function getMachines (info) {
  const sql = `select device_id, last_online, now() - last_online < $1 as stale from devices
  where display=TRUE and
  paired=TRUE
  order by created`

  return db.any(sql, [STALE_INTERVAL])
    .then(_.map(_.partial(mapMachine, [info])))
}

function sendRadar (data) {
  const config = {
    url: options.coinAtmRadar.url,
    method: 'post',
    data,
    timeout: TIMEOUT,
    maxContentLength: MAX_CONTENT_LENGTH
  }

  return axios(config)
}

function mapRecord (info) {
  const timestamp = new Date().toISOString()
  return getMachines(info)
    .then(machines => ({
      operatorId: options.operatorId,
      timestamp,
      machines
    }))
}

function update (info) {
  return mapRecord(info).then(sendRadar)
}
