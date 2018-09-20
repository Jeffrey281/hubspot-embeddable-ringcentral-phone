/**
 * hubspot api related
 */

import {HSConfig} from './custom-app-config'
import {createElementFromHTML, findParentBySel} from './helpers'
import fetch, {jsonHeader} from '../common/fetch'
import _ from 'lodash'
import logo from './rc-logo'

let {
  appKeyHS,
  appSecretHS,
  appServerHS,
  apiServerHS,
  appRedirectHS
} = HSConfig

let refreshToken
let accessToken
let rcLogined = false
let tokenHandler
let cache = {}
let cacheKey = 'contacts'
const cacheTime = 10 * 1000 //10 seconds cache

const appRedirectHSCoded = encodeURIComponent(appRedirectHS)
const authUrl = `${appServerHS}/oauth/authorize?` +
`client_id=${appKeyHS}` +
`&redirect_uri=${appRedirectHSCoded}&scope=contacts`
const blankUrl = 'about:blank'
const serviceName = 'HubSpot'

/**
 * build name from contact info
 * @param {object} contact
 * @return {string}
 */
function buildName(contact) {
  let firstname = _.get(
    contact,
    'properties.firstname.value'
  ) || 'noname'
  let lastname = _.get(
    contact,
    'properties.firstname.value'
  ) || 'noname'
  return firstname + ' ' + lastname
}

/**
 * build phone numbers from contact info
 * @param {object} contact
 * @return {array}
 */
function buildPhone(contact) {
  let phoneNumber = _.get(contact, 'properties.phone.value')
  return phoneNumber
    ? [
      {
        phoneNumber,
        phoneType: 'directPhone'
      }
    ]
    : []
}

/**
 * search contacts by number match
 * @param {array} contacts
 * @param {string} keyword
 */
function findMatchContacts(contacts, numbers) {
  let res = contacts.filter(contact => {
    let {
      phoneNumbers
    } = contact
    return _.find(phoneNumbers, n => {
      return numbers.includes(n.phoneNumber)
    })
  })
  return res.reduce((prev, it) => {
    let phone = _.find(it.phoneNumbers, n => {
      return numbers.includes(n.phoneNumber)
    })
    let num = phone.phoneNumber
    if (!prev[num]) {
      prev[num] = []
    }
    let res = {
      entityType: it.type,
      name: it.name,
      phoneNumbers: it.phoneNumbers
    }
    prev[num].push(res)
    return prev
  }, {})
}


/**
 * search contacts by keyword
 * @param {array} contacts
 * @param {string} keyword
 */
function searchContacts(contacts, keyword) {
  return contacts.filter(contact => {
    let {
      name,
      phoneNumbers
    } = contact
    return name.includes(keyword) ||
      _.find(phoneNumbers, n => {
        return n.phoneNumber.includes(keyword)
      })
  })
}

/**
 * convert hubspot contacts to ringcentral contacts
 * @param {array} contacts
 * @return {array}
 */
function formatContacts(contacts) {
  return contacts.map(contact => {
    return {
      id: contact.vid,
      name: buildName(contact),
      type: 'HubSpot',
      phoneNumbers: buildPhone(contact)
    }
  })
}
/**
 * get contact list, one single time
 */
async function getContact(
  vidOffset = 0,
  count = 100
) {
  //https://api.hubapi.com/contacts/v1/lists/all/contacts/all
  let url =`${apiServerHS}/contacts/v1/lists/all/contacts/all?count=${count}&vidOffset=${vidOffset}&property=firstname&property=phone&property=lastname`
  let res = await fetch.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...jsonHeader
    }
  })
  if (res && res.contacts) {
    return res
  } else {
    console.log('fetch contacts error')
    console.log(res)
    return {
      contacts: [],
      'has-more': false,
      'vid-offset': vidOffset
    }
  }
}

/**
 * get all contacts
 */
async function getContacts() {
  if (!rcLogined) {
    return []
  }
  if (!accessToken) {
    showAuthBtn()
    return []
  }
  let now = + new Date()
  let cacheLastTime = _.get(cache, `${cacheKey}.time`)
  if (cacheLastTime && now - cacheLastTime < cacheTime) {
    console.log('return cache')
    return cache[cacheKey].value
  }
  let contacts = []
  let res = await getContact()
  contacts = [
    ...contacts,
    ...res.contacts
  ]
  while (res['has-more']) {
    res = await getContact(res['vid-offset'])
    contacts = [
      ...contacts,
      ...res.contacts
    ]
  }
  let final = formatContacts(contacts)
  cache[cacheKey] = {
    time: + new Date(),
    value: final
  }
  return final
}

function getRefreshToken() {
  getAuthToken({
    refresh_token: refreshToken
  })
}

function notifyRCAuthed(authorized = true) {
  document
    .querySelector('#rc-widget-adapter-frame')
    .contentWindow
    .postMessage({
      type: 'rc-adapter-update-authorization-status',
      authorized
    }, '*')
}

async function getAuthToken({
  code,
  refresh_token
}) {
  let url = `${apiServerHS}/oauth/v1/token`
  let data = (
    code
      ? 'grant_type=authorization_code'
      : 'grant_type=refresh_token'
  ) +
  `&client_id=${appKeyHS}&` +
  `client_secret=${appSecretHS}&` +
  `redirect_uri=${appRedirectHSCoded}&` +
    (
      code
        ? `code=${code}`
        : `refresh_token=${refresh_token}`
    )

  let res = await fetch.post(url, data, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
    },
    body: data
  })

  /**
{
  "access_token": "xxxx",
  "refresh_token": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "expires_in": 21600
}
   */
  if (!res || !res.access_token) {
    console.log('get token failed')
    console.log(res)
  } else {
    accessToken = res.access_token
    refreshToken = res.refresh_token
    notifyRCAuthed()
    tokenHandler = setTimeout(
      getRefreshToken,
      Math.floor(res.expires_in * .8)
    )
  }
}

function unAuth() {
  accessToken = null
  clearTimeout(tokenHandler)
  notifyRCAuthed(false)
}

function doAuth() {
  if (accessToken) {
    return
  }
  hideAuthBtn()
  let frameWrap = document.getElementById('rc-auth-hs')
  let frame = document.getElementById('rc-auth-hs-frame')
  if (frame) {
    frame.src = authUrl
  }
  frameWrap && frameWrap.classList.remove('rc-hide-to-side')
}

function hideAuthPanel() {
  let frameWrap = document.getElementById('rc-auth-hs')
  let frame = document.getElementById('rc-auth-hs-frame')
  if (frame) {
    frame.src = blankUrl
  }
  frameWrap && frameWrap.classList.add('rc-hide-to-side')
}

function hideAuthBtn() {
  let dom = document.querySelector('.rc-auth-button-wrap')
  dom && dom.classList.add('rc-hide-to-side')
}

function showAuthBtn() {
  let dom = document.querySelector('.rc-auth-button-wrap')
  dom && dom.classList.remove('rc-hide-to-side')
}

function handleAuthClick(e) {
  let {target} = e
  let {classList}= target
  if (findParentBySel(target, '.rc-auth-btn')) {
    doAuth()
  } else if (classList.contains('rc-dismiss-auth')) {
    hideAuthBtn()
  }
}

function renderAuthButton() {
  let btn = createElementFromHTML(
    `
      <div class="rc-auth-button-wrap animate rc-hide-to-side">
        <span class="rc-auth-btn">
          <span class="rc-iblock">Auth</span>
          <img class="rc-iblock" src="${logo}" />
          <span class="rc-iblock">access HubSpot data</span>
        </span>
        <div class="rc-auth-desc rc-pd1t">
          After auth, you can access hubspot contacts from RingCentral phone's contacts list.
        </div>
        <div class="rc-pd1t">
          <span class="rc-dismiss-auth" title="dismiss">&times;</span>
        </div>
      </div>
    `
  )
  btn.onclick = handleAuthClick
  if (
    !document.querySelector('.rc-auth-button-wrap')
  ) {
    document.body.appendChild(btn)
  }
}

function renderAuthPanel() {
  let pop = createElementFromHTML(
    `
    <div id="rc-auth-hs" class="animate rc-auth-wrap rc-hide-to-side" draggable="false">
      <div class="rc-auth-frame-box">
        <iframe class="rc-auth-frame" sandbox="allow-same-origin allow-scripts allow-forms allow-popups" allow="microphone" src="${blankUrl}" id="rc-auth-hs-frame">
        </iframe>
      </div>
    </div>
    `
  )
  if (
    !document.getElementById('rc-auth-hs')
  ) {
    document.body.appendChild(pop)
  }
}

/**
 * handle ringcentral widgets contacts list events
 * @param {Event} e
 */
async function handleRCEvents(e) {
  let {data} = e
  console.log('data')
  console.log(data)
  if (!data) {
    return
  }
  let {type, loggedIn, path} = data
  if (type ===  'rc-login-status-notify') {
    console.log('rc logined', loggedIn)
    rcLogined = loggedIn
  }
  if (
    type === 'rc-route-changed-notify' &&
    path === '/contacts' &&
    !accessToken
  ) {
    showAuthBtn()
  }
  if (type !== 'rc-post-message-request') {
    return
  }
  let rc = document.querySelector('#rc-widget-adapter-frame').contentWindow

  if (data.path === '/authorize') {
    if (accessToken) {
      unAuth()
    } else {
      doAuth()
    }
    rc.postMessage({
      type: 'rc-post-message-response',
      responseId: data.requestId,
      response: { data: 'ok' }
    }, '*')
  }
  else if (path === '/contacts') {
    let contacts = await getContacts()
    rc.postMessage({
      type: 'rc-post-message-response',
      responseId: data.requestId,
      response: {
        data: contacts,
        nextPage: null
      }
    }, '*')
  }
  else if (path === '/contacts/search') {
    let contacts = await getContacts()
    let keyword = _.get(data, 'body.searchString')
    if (keyword) {
      contacts = searchContacts(contacts, keyword)
    }
    rc.postMessage({
      type: 'rc-post-message-response',
      responseId: data.requestId,
      response: {
        data: contacts
      }
    }, '*')
  }
  else if (path === '/contacts/match') {
    let contacts = await getContacts()
    let phoneNumbers = _.get(data, 'body.phoneNumbers') || []
    let res = findMatchContacts(contacts, phoneNumbers)
    rc.postMessage({
      type: 'rc-post-message-response',
      responseId: data.requestId,
      response: {
        data: res
      }
    }, '*')
  }
}

/**
 * init auth event, dom render etc
 */
let authEventInited = false
export function initHubSpotAPI() {
  if (authEventInited) {
    return
  }
  authEventInited = true

  //get the html ready
  renderAuthPanel()
  renderAuthButton()

  //wait for auth token
  window.addEventListener('message', function (e) {
    const data = e.data
    if (data && data.hsAuthCode) {
      getAuthToken({
        code: data.hsAuthCode
      })
      hideAuthPanel()
      hideAuthBtn()
    }
  })

  let rcFrame = document.querySelector('#rc-widget-adapter-frame')
  if (!rcFrame || !rcFrame.contentWindow) {
    return
  }

  //register service to rc-widgets
  rcFrame
    .contentWindow.postMessage({
      type: 'rc-adapter-register-third-party-service',
      service: {
        name: serviceName,
        contactsPath: '/contacts',
        contactSearchPath: '/contacts/search',
        contactMatchPath: '/contacts/match',
        authorizationPath: '/authorize',
        authorizedTitle: 'Unauthorize',
        unauthorizedTitle: 'Authorize',
        authorized: false
      }
    }, '*')

  //hanlde contacts events
  window.addEventListener('message', handleRCEvents)


}

