import fs from 'fs';

async function run() {
    console.log("Sending request to /api/chat ...");
    try {
        const res = await fetch("http://localhost:3000/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: "明天下午3点开会" }]
            })
        });
        const status = res.status;
        const text = await res.text();
        fs.writeFileSync('test_api_out.json', JSON.stringify({ status, textLength: text.length, textPrefix: text.substring(0, 500) }, null, 2));
    } catch (err) {
        fs.writeFileSync('test_api_out.json', JSON.stringify({ error: err.message }, null, 2));
    }
}
run();
