import { google } from '@ai-sdk/google';
import { streamText } from 'ai';

// Allow streaming responses up to 120 seconds (Pro models think longer)
export const maxDuration = 120;

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();
        const url = new URL(req.url);
        const model = url.searchParams.get('model') || 'gemini-3.1-pro-preview';

        // Convert messages: map image parts for the AI SDK format
        const processedMessages = messages.map((msg: any) => {
            if (Array.isArray(msg.content)) {
                return {
                    role: msg.role,
                    content: msg.content.map((part: any) => {
                        if (part.type === 'image') {
                            return {
                                type: 'image' as const,
                                image: part.image, // base64 data
                                mimeType: part.mimeType || 'image/jpeg',
                            };
                        }
                        return part;
                    }),
                };
            }
            return msg;
        });

        const result = streamText({
            model: google(model),
            messages: processedMessages,
            tools: {
                google_search: google.tools.googleSearch({}),
            },
            providerOptions: {
                google: {
                    thinkingConfig: { thinkingBudget: 1024 },
                }
            },
        });

        return result.toUIMessageStreamResponse({
            onError: (error: any) => {
                console.error('Stream Error:', error);
                return String(error?.message || error);
            }
        });
    } catch (error) {
        console.error('API Error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
