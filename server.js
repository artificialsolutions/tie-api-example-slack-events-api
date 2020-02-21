/**
 * Copyright 2018 Artificial Solutions. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *    http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const slackEventsApi = require('@slack/events-api');
const SlackClient = require('@slack/client').WebClient;
const http = require('http');
const express = require('express');
const TIE = require('@artificialsolutions/tie-api-client');
const dotenv = require('dotenv');
dotenv.config();

// mandatory environment variables
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackBotUserOAuthToken = process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN;
const teneoEngineUrl = process.env.TENEO_ENGINE_URL;


// optional environment variables
const port = process.env.PORT || 3000;

// initialize event adapter using signing secret from environment variables
const slackEvents = slackEventsApi.createEventAdapter(slackSigningSecret, {
  includeHeaders: true
});

// initialize a slack webclient for posting messages
const slack = new SlackClient(slackBotUserOAuthToken);

// initialize a Teneo client for interacting with TeneoEengine
const teneoApi = TIE.init(teneoEngineUrl);

// initialize an Express application
const app = express();

// basic response for get request at root
app.get('/', (req, res) => {
  res.send('Teneo Slack Connector running');
});

// plug the event adapter into the express app as middleware
app.use('/slack/events', slackEvents.expressMiddleware());

// initialise session handler, to store mapping between slack 'channel' and engine session
const sessionHandler = SessionHandler();

// *** attach listeners to the event adapter ***

// *** send messages to Engine and handle response ***
slackEvents.on('message', (message, headers) => {

  // only deal with messages that have no subtype (plain messages) and that are not retries
  if (!message.subtype && !headers["x-slack-retry-reason"] && !message.bot_id) {
    // handle initialization failure
    if (!slack) {
      return console.error('No slack webclient. Did you provide a valid SLACK_BOT_USER_ACCESS_TOKEN?');
    }
    // send message to engine an return answer
    handleSlackMessage(sessionHandler, message);
  }
});


// *** handle errors ***
slackEvents.on('error', (error) => {
  if (error.code === slackEventsApi.errorCodes.TOKEN_VERIFICATION_FAILURE) {
    // this error type also has a `body` propery containing the request body which failed verification.
    console.error(`An unverified request was sent to the Slack events Request URL. Request body: ${JSON.stringify(error.body)}`);
  } else {
    console.error(`An error occurred while handling a Slack event: ${error.message}`);
  }
});

// start the express application
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});

async function handleSlackMessage(sessionHandler, message) {

  try {
    console.log(`Got message '${message.text}' from channel ${message.channel}`);

    // find engine session id mapped to channel id
    const sessionId = await sessionHandler.getSession(message.channel);

    // send message to engine using sessionId
    const teneoResponse = await teneoApi.sendInput(sessionId, {
      text: message.text,
      'channel': 'slack'
    });

    console.log(`Got Teneo Engine response '${teneoResponse.output.text}' for session ${teneoResponse.sessionId}`);

    // store mapping between channel and engine sessionId
    await sessionHandler.setSession(message.channel, teneoResponse.sessionId);

    // construct slack message with using the response from engine
    const slackMessage = createSlackMessage(message.channel, teneoResponse);

    // send message to slack with engine output text
    await sendSlackMessage(slackMessage);

  } catch (error) {
    console.error(`Failed when sending input to Teneo Engine @ ${teneoEngineUrl}`, error);
  }

}

// create slack message
function createSlackMessage(channel, teneoResponse) {

  // your bot can use output parameters to populate attachments
  // you would find those in teneoResponse.output.parameters
  const message = {};

  // populate base message
  message.text = teneoResponse.output.text;
  message.channel = channel;

  // check for attachment
  if (teneoResponse.output.parameters.slack) {
    try {
      message.attachments = [JSON.parse(teneoResponse.output.parameters.slack)];
    } catch (error_attach) {
      console.error(`Failed when parsing attachment JSON`, error_attach);
    }
  }
  return message
}

// send slack message
function sendSlackMessage(messageData) {
  slack.chat.postMessage(messageData)
    .catch(console.error);
}

/* *
 * SESSION HANDLER
 * */
function SessionHandler() {

  // Map the slack user id to the teneo engine session id. 
  // This code keeps the map in memory, which is ok for testing purposes
  // For production usage it is advised to make use of more resilient storage mechanisms like redis
  const sessionMap = new Map();

  return {
    getSession: (userId) => new Promise((resolve, reject) => {
      if (sessionMap.size > 0) {
        resolve(sessionMap.get(userId));
      }
      else {
        resolve("")
      }
    }),
    setSession: (userId, sessionId) => new Promise((resolve, reject) => {
      sessionMap.set(userId, sessionId);
      resolve();
    })
  };
}