import {Handler} from "aws-lambda/handler";

export function load(taskRoot?: string, originalHandler?: string): Promise<Handler>;
