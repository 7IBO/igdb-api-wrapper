import { IGDBError } from "../core/errors";
import type { EndpointName } from "../generated/schema";
import type { ExecuteOptions, RawResponse } from "../query/query";

export type WebhookOperation = "create" | "update" | "delete";

const OPERATIONS: Record<number, WebhookOperation> = { 0: "create", 1: "delete", 2: "update" };

/** A webhook registered on IGDB. */
export interface Webhook {
  id: number;
  url: string;
  operation: WebhookOperation;
  /** IGDB deactivates a webhook after 5 failed deliveries; registering it again reactivates it. */
  active: boolean;
  /** Failed deliveries in a row. */
  retries: number;
  secret: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RawWebhook {
  id: number;
  url: string;
  sub_category: number;
  active: boolean;
  number_of_retries: number;
  secret: string;
  created_at: number;
  updated_at: number;
}

function toWebhook(raw: RawWebhook): Webhook {
  return {
    id: raw.id,
    url: raw.url,
    operation: OPERATIONS[raw.sub_category] ?? "update",
    active: raw.active,
    retries: raw.number_of_retries,
    secret: raw.secret,
    createdAt: new Date(raw.created_at * 1000),
    updatedAt: new Date(raw.updated_at * 1000),
  };
}

/** @internal */
export type WebhookRequest = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  body: string | undefined,
  options?: ExecuteOptions,
) => Promise<RawResponse>;

export interface RegisterWebhookOptions {
  /** Where IGDB will POST. Must answer 200 within 15 s. */
  url: string;
  /** Sent back in the `X-Secret` header of every delivery, so you can check it comes from IGDB. */
  secret: string;
  operation: WebhookOperation;
}

export interface EnsureWebhooksOptions<N extends EndpointName> {
  /** Base URL of your handler. `endpoint` and `operation` query parameters are added to it. */
  url: string;
  secret: string;
  endpoints: readonly N[];
  /** Default: create, update and delete. */
  operations?: readonly WebhookOperation[] | undefined;
}

/** Registers, lists and removes the webhooks of your Twitch app. */
export class Webhooks {
  /** @internal */
  constructor(private readonly request: WebhookRequest) {}

  /**
   * Registers a webhook. Registering the same URL and operation again returns the existing webhook
   * and reactivates it if IGDB had deactivated it.
   */
  async register(endpoint: EndpointName, options: RegisterWebhookOptions): Promise<Webhook> {
    const body = new URLSearchParams({ url: options.url, secret: options.secret, method: options.operation });
    const { data } = await this.request("POST", `${endpoint}/webhooks`, body.toString());
    return toWebhook(first(data));
  }

  /**
   * Registers every endpoint and operation on one handler, adding `?endpoint=…&operation=…` to the
   * URL. Call it at startup: it is idempotent and brings back webhooks IGDB deactivated.
   */
  async ensure<N extends EndpointName>(options: EnsureWebhooksOptions<N>): Promise<Webhook[]> {
    const operations = options.operations ?? ["create", "update", "delete"];
    const jobs = options.endpoints.flatMap((endpoint) =>
      operations.map((operation) => {
        const url = new URL(options.url);
        url.searchParams.set("endpoint", endpoint);
        url.searchParams.set("operation", operation);
        return this.register(endpoint, { url: url.toString(), secret: options.secret, operation });
      }),
    );
    return Promise.all(jobs);
  }

  async list(): Promise<Webhook[]> {
    const { data } = await this.request("GET", "webhooks", undefined);
    return (data as RawWebhook[]).map(toWebhook);
  }

  async get(id: number): Promise<Webhook | null> {
    const { data } = await this.request("GET", `webhooks/${id}`, undefined);
    const raw = (data as RawWebhook[])[0];
    return raw && typeof raw === "object" ? toWebhook(raw) : null;
  }

  /** Removes a webhook. Removing one that does not exist is not an error. */
  async delete(id: number): Promise<void> {
    await this.request("DELETE", `webhooks/${id}`, undefined);
  }

  /** Asks IGDB to send entity `entityId` to the webhook now. Returns IGDB's report. */
  async test(endpoint: EndpointName, id: number, entityId: number): Promise<string> {
    const { data } = await this.request(
      "POST",
      `${endpoint}/webhooks/test/${id}?entityId=${entityId}`,
      undefined,
    );
    return typeof data === "string" ? data : JSON.stringify(data);
  }
}

function first(data: unknown): RawWebhook {
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw || typeof raw !== "object") throw new IGDBError("IGDB returned no webhook");
  return raw as RawWebhook;
}
