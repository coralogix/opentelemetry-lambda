import {Handler} from "aws-lambda/handler.js";

export function load(taskRoot?: string, originalHandler?: string): Promise<Handler>;
