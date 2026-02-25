const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const apiKeyMatch = envFile.match(/GOOGLE_GENERATIVE_AI_API_KEY=(.*)/);
const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : null;

if (!apiKey) {
    console.error("Missing API Key");
    process.exit(1);
}

const genai = new GoogleGenAI({ apiKey });

async function run() {
    try {
        console.log("1. Generating initial image...");
        const response1 = await genai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: [{
                role: 'user',
                parts: [{ text: "Draw a simple red apple on a white background." }]
            }],
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
            }
        });

        const imagePart = response1.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!imagePart) {
            console.error("No image generated in first step.");
            console.dir(response1, { depth: null });
            return;
        }

        const base64Image = imagePart.inlineData.data;
        const mimeType = imagePart.inlineData.mimeType;
        console.log(`Initial image generated. MimeType: ${mimeType}, Size: ${base64Image.length} bytes`);
        fs.writeFileSync('test1.jpg', Buffer.from(base64Image, 'base64'));

        console.log("\n2. Attempting to edit the generated image...");
        console.log("Using model: gemini-2.5-flash with image reference");
        const response2 = await genai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: [{
                role: 'user',
                parts: [
                    { text: "Change the apple to be green." },
                    { inlineData: { data: base64Image, mimeType: mimeType } }
                ]
            }],
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
            }
        });

        const editedPart = response2.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!editedPart) {
            console.error("No image generated in editing step.");
            console.dir(response2, { depth: null });
            return;
        }

        console.log(`Edited image generated. Size: ${editedPart.inlineData.data.length} bytes`);
        fs.writeFileSync('test2.jpg', Buffer.from(editedPart.inlineData.data, 'base64'));
        console.log("Success! Both images saved locally.");

    } catch (e) {
        console.error("\nTest failed:");
        console.error(e.message);
        if (e.statusDetails) console.error(JSON.stringify(e.statusDetails, null, 2));
    }
}

run();
