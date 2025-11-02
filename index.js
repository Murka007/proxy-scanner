import fs from "fs";
import { SocksProxyAgent } from "socks-proxy-agent";
import axios from "axios";
import WebSocket from "ws";

console.log("Initialization..");

const INPUT_FILE = "public/proxies.txt";
const OUTPUT_FILE = "public/found.txt";

const WAIT_TIME = 3000;
const BATCH_SIZE = 100;
const testHttpUrl = "https://api.ipify.org";
const testWssUrl = "wss://ws.postman-echo.com/raw";

const input = fs.readFileSync(INPUT_FILE, "utf8");
const proxies = input.split(/\n+/);

const checkHTTP = async (agent) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WAIT_TIME);
    try {
        const res = await axios.get(testHttpUrl, { httpsAgent: agent, signal: controller.signal });
        return {
            ok: true,
            ip: res.data
        }
    } catch (err) {
        return { ok: false, error: err.message }
    } finally {
        clearTimeout(timeout);
    }
}

const checkSocket = (agent) => {
    return new Promise(resolve => {
        const ws = new WebSocket(testWssUrl, { agent });

        const timer = setTimeout(() => {
            ws.terminate();
            resolve({ ok: false, error: "WebSocket timeout" });
        }, WAIT_TIME);

        ws.on("open", () => {
            ws.send("ping");
            
            ws.on("message", () => {
                clearTimeout(timer);
                ws.close();
                resolve({ ok: true });
            })
        })

        ws.on("error", err => {
            clearTimeout(timer);
            resolve({ ok: false, error: err.message });
        })
    })
}

const checkProxy = async (proxy) => {
    const [ proxy_ip, proxy_port ] = proxy.split(":");
    const agent = new SocksProxyAgent(`socks5://${proxy_ip}:${proxy_port}`);
    const http = await checkHTTP(agent);
    if (!http.ok) {
        console.log(`❌ ${proxy} ${http.error}`);
        return null;
    }

    if (http.ip !== proxy_ip) {
        console.log(`❌ ${proxy} returned wrong IP`);
        return null;
    }

    const wss = await checkSocket(agent);
    if (!wss.ok) {
        console.log(`❌ WSS ${proxy} failed: ${wss.error}`);
        return null;
    }

    console.log(`✅ ${proxy} is valid!`);
    return true;
}

(async () => {
    fs.writeFileSync(OUTPUT_FILE, "", "utf8");
    let proxyCount = 0;

    console.log("Checking proxies..");

    const proxyList = [];
    for (let i = 0; i < proxies.length; i += BATCH_SIZE) {
        proxyList.length = 0;
        const batch = proxies.slice(i, i + BATCH_SIZE);

        const tasks = batch.map(proxy => {
            const match = proxy.trim().match(/\d+\.\d+\.\d+\.\d+:\d+$/);
            if (match === null) Promise.resolve(false);
            return checkProxy(match[0]);
        })

        const results = await Promise.allSettled(tasks);
        results.forEach((r, idx) => {
            if (r.status === "fulfilled" && r.value) {
                proxyList.push(batch[idx]);
            }
        })

        if (proxyList.length !== 0) {
            fs.appendFileSync(OUTPUT_FILE, proxyList.join("\n") + "\n");
            proxyCount += proxyList.length;
        }
    }

    console.log(`Found ${proxyCount} working proxies!`);
    process.exit(0);
})();