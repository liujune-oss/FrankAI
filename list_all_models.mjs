import fs from 'fs';
try {
    const envFile = fs.readFileSync('.env.local', 'utf-8');
    const apiKeyLine = envFile.split('\n').find(line => line.includes('GOOGLE_GENERATIVE_AI_API_KEY'));
    const apiKey = apiKeyLine.split('=')[1].trim();

    fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey)
        .then(res => res.json())
        .then(data => {
            if (data.models) {
                const models = data.models.map(m => m.name);
                fs.writeFileSync('all_models.json', JSON.stringify(models, null, 2));
            }
        });
} catch (e) {
    console.error(e);
}
