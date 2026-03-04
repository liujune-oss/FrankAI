export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    parts: { type: string; text: string }[];
    thinking?: string;
    images?: { data: string; mimeType: string }[];
}
