# tie-api-example-slack-events-api
This node.js example connector allows you to make your Teneo bot available on Slack. The connector acts as middleware between Slack and Teneo and uses the Slack Events API to receive messages from Slack. This guide will take you through the steps of creating a new Slack app and deploying the connector to respond to events sent by Slack.

## Prerequisites
### Https
The Slack Events API requires that the connector is available via https. On this page we will be using Heroku to host this connector, for which a (free) Heroku account is needed. You can however also manually install the connector on a location of your choice, see [Running the connector locally](#running-the-connector-locally).

### Teneo Engine
Your bot needs to be published and you need to know the engine url.

## Setup instructions
### Create a Slack app
Create a new Slack app here: [https://api.slack.com/apps](https://api.slack.com/apps?new_app=1). Give it a name and add it to the appropriate workspace.

On the page that appears, scroll to the bottom of the screen and copy the 'Signing Secret'. You will need it later when you deploy the connector.

## Add Bot Token Scopes
In the left navigation menu under 'Features' choose 'OAuth & Permissions'. Scroll down until you see 'Scopes'. Under 'Bot Token Scopes' click the 'Add an OAuth Scope' button. In the field that appears type 'chat:write'

### Install App to Workspace
Still on the 'OAuth & Permissions', scroll back to the top and click the 'Install App to Workspace' button and authorize. Copy the 'Bot User OAuth Access Token', you will need it in the next step when you deploy the connector.

### Deploy the connector
Click the button below to deploy the connector to Heroku:

[![Deploy](https://www.herokucdn.com/deploy/button.svg?classes=noborder)](https://heroku.com/deploy?template=https://github.com/artificialsolutions/tie-api-example-slack-events-api)

In the 'Config Vars' section, add the following:
* **SLACK_SIGNING_SECRET:** The 'Signing Secret' you copied when you created the Slack app 
* **SLACK_BOT_USER_OAUTH_ACCESS_TOKEN:** The 'Bot User OAuth Access Token' you copied when you installed the app to your workspace
* **TENEO_ENGINE_URL:** The engine url

Click 'View app' and copy the url of your Heroku app, you will need it in the next step.

If you prefer to run your bot locally, see [Running the connector locally](#running-the-connector-locally).

### Subscribe to events
Go back to your app on Slack. In the left navigation menu under 'Features' choose 'Event Subscriptions'. Then:
1. Turn on Enable Events
2. Enter the following URL in the Request URL field: `https://[yourherokuappname].herokuapp.com/slack/events` (replace [yourherokuappname] with the name of your app on Heroku)
    Note that the url ends with '/slack/events', and that the connector is already running locally, or on Heroku, to avoid a 'Challenge parameter' error.
3. Under 'Subscribe to Bot Events', subscribe to the following event: `message.im`
4. Save changes. Reinstall the app, if recommended by the dashboard

That's it! Your bot should now be available as an app in Slack and ready to respont to the messages sent to it.

## Adding message attachments
To add [message attachments](https://api.slack.com/docs/message-attachments), this connector looks for an output parameter `slack` in the engine response. The value of that parameter is assumed to contain the attachement JSON as defined by Slack.

If we look at Slack's JSON specification of [attachments](https://api.slack.com/docs/message-attachments#attachment_structure), to attach an image the value of the `slack` output parameter would need to look like this: 
```
{
    "fallback": "Image description as fallback",
    "image_url": "https://url.to/an/image.png"
}
```

Note: although it is possible to add multiple attachments to a Slack message, this connector assumes the output parameter contains just the JSON for a single attachment.

## Running the connector locally
If you prefer to manually install this connector or run it locally, proceed as follows:
1. Download or clone the connector source code from [Github](https://github.com/artificialsolutions/tie-api-example-slack-events-api).
2. Install dependencies by running `npm install` in the folder where you stored the source.
3. Make sure your connector is available via https. When running locally you can for example use ngrok for this: [ngrok.com](https://ngrok.com). The connector runs on port 3000 by default.
    ```
    ngrok http 3000
    ```
4. Create a file called .env in the project's root folder, based on the sample file called '.env.sample' that is included in the project. Inside .env, replace the environment variables with the corresponding values: 
   ```
    SLACK_SIGNING_SECRET=<your_slack_signing_secret> SLACK_BOT_USER_OAUTH_ACCESS_TOKEN=<your_slack_bot_oauth_token> TENEO_ENGINE_URL=<your_engine_url> node server.js
    ```

5. Start the connector with the following command:
    ```
    node server.js
    ```