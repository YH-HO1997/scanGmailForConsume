import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { google } from 'googleapis';
import Gemini from "gemini-ai";

const dynamo = DynamoDBDocument.from(new DynamoDB());


/**
 * Demonstrates a simple HTTP endpoint using API Gateway. You have full
 * access to the request and response payload, including headers and
 * status code.
 *
 * To scan a DynamoDB table, make a GET request with the TableName as a
 * query string parameter. To put, update, or delete an item, make a POST,
 * PUT, or DELETE request respectively, passing in the payload to the
 * DynamoDB API as a JSON body.
 */

// 取得今天的月份
const date = new Date();
const year = date.getFullYear();
const month = date.getMonth() + 1; // getMonth() 返回的值是 0-11，所以需要加 1
const yyyyMM = parseInt(`${year}${month < 10 ? '0' : ''}${month}`);
date.setDate(date.getDate() - 7);
let amount = 0;

export const handler = async (event) => {

    // console.log('Received event:', JSON.stringify(event, null, 2));

    let body;
    let statusCode = '200';
    const headers = {
        'Content-Type': 'application/json',
    };

    try {
        const OAuth2 = google.auth.OAuth2;
        const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

        let oauth2Client = new OAuth2(
            CLIENT_ID,
            CLIENT_SECRET,
            'https://mwiaj00zv1.execute-api.ap-southeast-2.amazonaws.com/default/Oauth2',
        );

        // // 設定存取範圍
        oauth2Client.scope = SCOPES;

        // 设置 refresh token
        oauth2Client.setCredentials({
            refresh_token: REFRESH_TOKEN
        });
        await oauth2Client.refreshAccessToken();

        // 建立 Gmail API 服務
        const gmail = google.gmail({
            version: 'v1',
            auth: oauth2Client
        });

        // 取得7天前的 Gmail 信件
        const query = `label:BankConsume after:${date.toISOString().split('T')[0]}`;
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: query
        });

        // 取得郵件列表
        const messages = res.data.messages;

        let details = [];
        // 取得每封郵件詳情
        for (const message of messages) {
            const messageDetails = await gmail.users.messages.get({
                userId: 'me',
                id: message.id
            });
            details.push(messageDetails.data.snippet);
        }
        console.log(details);
        // amount = getNumbers(details);

        const gemini = new Gemini(API_KEY);
        const response = await gemini.ask('請以下內容計算，總共花費多少錢? 請給我算式，後面不要加單位' + JSON.stringify(details));
        console.log(response);
        amount = parseInt(response.match(/(\d+)$/)[0]);

        if (amount) {
            let monthlyConsume = await updateDB(amount);
            // 創建一個新的電子郵件消息
            let message = `To: a0910020888@gmail.com\r\nFrom: a0910020888@gmail.com\r\nSubject: scanGmailConsume\r\n\r\n
            This week costs ${response}\n
            This month already costs ${monthlyConsume}.`;
            let buffer = Buffer.from(message);
            let encodedStr = buffer.toString('base64');

            // Construct the RFC822 formatted email message string
            message = { 'raw': encodedStr };

            // Send the email using the Gmail API
            body = await gmail.users.messages.send({
                userId: 'me',
                resource: message
            });
        }

    }
    catch (err) {
        statusCode = '400';
        body = err.message;
    }
    finally {
        body = JSON.stringify(body);
    }

    return {
        statusCode,
        body,
        headers,
    };
};

async function updateDB(amount) {
    let params = {
        TableName: 'monthly_consume',
        Key: {
            Ym: yyyyMM,
        },
    };

    let result = await (dynamo.get(params));
    let consume = amount;

    // 如果不存在今天的月份的資料，則新建資料
    if (!result.Item) {
        params = {
            TableName: 'monthly_consume',
            Item: {
                Ym: yyyyMM,
                consume: amount,
            },
        };

        await (dynamo.put(params));
    }
    else {
        consume = parseInt(result.Item.consume) + amount;
        params = {
            TableName: 'monthly_consume',
            Key: {
                Ym: yyyyMM,
            },
            UpdateExpression: 'SET consume = :consume',
            ExpressionAttributeValues: {
                ':consume': consume,
            },
        };
        await (dynamo.update(params));
    }

    return consume;
}
