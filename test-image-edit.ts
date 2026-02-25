const { GoogleGenAI } = require('@google/genai');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config({ path: '.env.local' });

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!apiKey) {
    console.error("Missing API Key");
    process.exit(1);
}

const genai = new GoogleGenAI({ apiKey });

async function run() {
    try {
        console.log("1. Generating initial image...");
        const response1 = await genai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [{ text: "Draw a simple red apple on a white background." }]
            }],
            config: {
                responseModalities: ['IMAGE'],
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

        console.log("2. Attempting to edit the generated image...");
        const response2 = await genai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [
                    { text: "Change the apple to be green." },
                    { inlineData: { data: base64Image, mimeType: mimeType } }
                ]
            }],
            config: {
                responseModalities: ['IMAGE'],
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
        console.error("Test failed:");
        console.error(e.message);
        if (e.statusDetails) console.error(e.statusDetails);
    }
}

run();
