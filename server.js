const slackEventsApi = require('@slack/events-api');
const SlackClient = require('@slack/client').WebClient;
const http = require('http');
const express = require('express');
const redis = require('redis');
const TIE = require('@artificialsolutions/tie-api-client');

// mandatory environment variables
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackBotUserOAuthToken = process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN;
const teneoEngineUrl = process.env.TENEO_ENGINE_URL;

// optional environment variables
const redisCloudUrl = process.env.REDISCLOUD_URL;
const port = process.env.PORT || 3000;

// initialize event adapter using signing secret from environment variables
const slackEvents = slackEventsApi.createEventAdapter(slackSigningSecret, {
  includeBody: true
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

// *** attach listeners to the event adapter ***

// *** send messages to Engine and handle response ***
slackEvents.on('message', (message) => {

  // only deal with messages that have no subtype (plain messages)
  if (!message.subtype) {

    console.log(message);

    // handle initialization failure
    if (!slack) {
      return console.error('No slack webclient. Did you provide a valid SLACK_BOT_USER_ACCESS_TOKEN?');
    }

    handleSlackMessage(SessionHandler(),message);

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

async function handleSlackMessage(sessionHandler,message) {

  try {
    console.log(`Got message '${message.text}' from channel ${message.channel}`);

    // find engine session id mapped to channel id
    const sessionId = await sessionHandler.getSession(message.channel);

    // send message to engine using sessionId
    const teneoResponse = await teneoApi.sendInput(sessionId, {
      text: message.text
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
  return {
    text: teneoResponse.output.text,
    channel: channel
  };
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
  const redisClient = redis.createClient({ prefix: 'sl', url: redisCloudUrl});

  return {
    getSession: (userId) => new Promise((resolve, reject) => {
      redisClient.get(userId, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    }),
    setSession: (userId, sessionId) => new Promise((resolve, reject) => {
      redisClient.set(userId, sessionId, (err1) => {
        if (err1) reject(err1);

        const oneDay = 24 * 60 * 60;
        redisClient.expire(userId, oneDay, (err2) => {
          if (err2) reject(err2);
          resolve();
        });
      });
    })
  };
}