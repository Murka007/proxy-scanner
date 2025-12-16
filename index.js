import fs from "fs";
import { SocksProxyAgent } from "socks-proxy-agent";
import axios from "axios";
import WebSocket from "ws";

console.log("Initialization..");

const USE_CUSTOM_LIST = false;
const INPUT_FILE = "public/proxies.txt";
const OUTPUT_FILE = "public/found.txt";

const WAIT_TIME = 5000;
const BATCH_SIZE = 100;
const testHttpUrl = "https://api.ipify.org";
const testWssUrl = "wss://ws.postman-echo.com/raw";

const proxyURLList = [
    "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/refs/heads/main/proxies/protocols/socks5/data.txt",
    "https://raw.githubusercontent.com/ClearProxy/checked-proxy-list/refs/heads/main/socks5/raw/all.txt",
    "https://raw.githubusercontent.com/databay-labs/free-proxy-list/refs/heads/master/socks5.txt",
    "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/refs/heads/master/socks5.txt",
    "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt",
    "https://raw.githubusercontent.com/vmheaven/VMHeaven-Free-Proxy-Updated/refs/heads/main/socks5.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/refs/heads/main/proxies/socks5.txt",
    "https://raw.githubusercontent.com/s0mecode/socks5-proxies/refs/heads/main/socks5_1000ms.txt",
    "https://raw.githubusercontent.com/r00tee/Proxy-List/refs/heads/main/Socks5.txt",
    "https://raw.githubusercontent.com/zloi-user/hideip.me/refs/heads/master/socks5.txt",
    "https://98dun.cc/proxy.txt",
];

const getProxies = async () => {
    if (USE_CUSTOM_LIST) {
        console.log("Retrieving proxies from custom list..");
        const input = fs.readFileSync(INPUT_FILE, "utf8");
        return input.split(/\n+/);
    }

    const proxies = [];
    for (const url of proxyURLList) {
        try {
            console.log(`Fetching proxies from: ${url}`);
            const res = await fetch(url);
            const content = await res.text();

            let count = 0;
            const list = content.split(/\n+/);
            for (const proxy of list) {
                const formatted = proxy.match(/\d+\.\d+\.\d+\.\d+:\d+/);
                if (formatted === null || proxies.indexOf(formatted[0]) !== -1) continue;
                proxies.push(formatted[0]);
                count++;
            }
            console.log(`Found '${count}' unique proxies..`);
        } catch(err){}
    }
    return proxies;
}

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
    if (!http.ok || http.ip !== proxy_ip) {
        return null;
    }

    const wss = await checkSocket(agent);
    if (!wss.ok) {
        return null;
    }

    console.log(`${proxy} is valid!`);
    return true;
}

(async () => {
    fs.writeFileSync(OUTPUT_FILE, "", "utf8");

    const proxies = await getProxies();
    let proxyCount = 0;
    console.log(`Checking '${proxies.length}' total proxies..`);

    const proxyList = [];
    for (let i = 0; i < proxies.length; i += BATCH_SIZE) {
        proxyList.length = 0;
        const batch = proxies.slice(i, i + BATCH_SIZE);

        const tasks = batch.map(checkProxy);
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