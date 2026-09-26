export type ChatRole = "user" | "tutor";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

export type ChatApiSuccess = {
  response: string;
  threadId: string;
};

export type ChatApiError = {
  error: string;
};
