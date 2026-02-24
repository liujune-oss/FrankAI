import { UIMessage } from "ai";

export interface ChatMessage extends UIMessage {
    thinking?: string;
    images?: { data: string; mimeType: string }[];
}
