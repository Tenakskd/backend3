"use strict";
const express = require("express");
let app = express();
const cluster = require("cluster");
const os = require("os");
const compression = require("compression");
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const numClusters = os.cpus().length;
if (cluster.isMaster) {
    for (let i = 0; i < numClusters; i++) {
        cluster.fork();
    }
    cluster.on("exit", (worker, code, signal) => {
        cluster.fork();
    });
} else {
    app.use(compression());
    app.listen(3000, () => {
        console.log(`Worker ${process.pid} started`);
    });
}

app.use(bodyParser.json());
app.use(cors());

let apis = null;
const MAX_API_WAIT_TIME = 3000;
const MAX_TIME = 10000;

async function getapis() {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/Tenakskd/ytserver/refs/heads/main/Des-Instance');
        apis = response.data;
        console.log('データを取得しました:', apis);
    } catch (error) {
        console.error('データの取得に失敗しました:', error);
    }
}

async function getRedirectUrl(url) {
    try {
        const response = await axios.get(url, { maxRedirects: 0 }); // リダイレクトを追わない
        return response.request.res.responseUrl; // 最終的なリダイレクト先の URL を返す
    } catch (error) {
        console.error(`リダイレクトでエラー: ${url} - ${error.message}`);
        throw new Error('リダイレクトの取得に失敗');
    }
}

async function ggvideo(videoId) {
    const startTime = Date.now();
    const instanceErrors = new Set();

    if (!apis) {
        await getapis();
    }

    for (const instance of apis) {
        try {
            const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, { timeout: MAX_API_WAIT_TIME });
            console.log(`使ってみたURL: ${instance}/api/v1/videos/${videoId}`);

            if (response.data && response.data.formatStreams) {
                const videoInfo = response.data;

                // リダイレクト先を取得
                const streamUrl = await getRedirectUrl(`https://invidious.nerdvpn.de/latest_version?id=${videoId}&itag=18`);
                const audioUrl = await getRedirectUrl(`https://invidious.nerdvpn.de/latest_version?id=${videoId}&itag=140`);
                const highstreamUrl = await getRedirectUrl(`https://invidious.nerdvpn.de/latest_version?id=${videoId}&itag=299`);

                // templateData の構造を作成する
                const templateData = {
                    stream_url: streamUrl,
                    highstreamUrl: highstreamUrl,
                    audioUrl: audioUrl,
                    videoId: videoId,
                    channelId: videoInfo.authorId,
                    channelName: videoInfo.author,
                    channelImage: videoInfo.authorThumbnails?.[videoInfo.authorThumbnails.length - 1]?.url || '',
                    videoTitle: videoInfo.title,
                    videoDes: videoInfo.descriptionHtml,
                    videoViews: videoInfo.viewCount,
                    likeCount: videoInfo.likeCount
                };

                return templateData;
            } else {
                console.error(`formatStreamsが存在しない: ${instance}`);
            }
        } catch (error) {
            console.error(`エラーだよ: ${instance} - ${error.message}`);
            instanceErrors.add(instance);
        }

        if (Date.now() - startTime >= MAX_TIME) {
            throw new Error("接続がタイムアウトしました");
        }
    }

    throw new Error("動画を取得する方法が見つかりません");
}

app.get('/', (req, res) => {
    res.sendStatus(200);
});

app.get('/data', (req, res) => {
    if (apis) {
        res.json(apis);
    } else {
        res.status(500).send('データを取得できていません');
    }
});

app.get('/refresh', async (req, res) => {
    await getapis();
    res.sendStatus(200);
});

app.get(['/api/:id', '/api/login/:id'], async (req, res) => {
    const videoId = req.params.id;
    try {
        const videoInfo = await ggvideo(videoId);

        res.json(videoInfo);
    } catch (error) {
        res.status(500).render('matte', {
            videoId,
            error: '動画を取得できません',
            details: error.message
        });
    }
});
