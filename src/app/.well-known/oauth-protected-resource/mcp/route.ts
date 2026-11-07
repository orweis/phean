import { auth } from "@/server/auth/auth";

export const GET = (request: Request) => auth.handler(request);
