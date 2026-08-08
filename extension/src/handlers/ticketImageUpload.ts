import type { UploadedTicketImage } from "./ticketDeliveryAutomation.ts";

// The reference bundle's primary candidate. A real sanitized upload response fixture
// is still required before treating this response path as confirmed production protocol.
export const GOOFISH_TICKET_IMAGE_UPLOAD_URL =
  "https://stream-upload.goofish.com/api/upload.api?floderId=0&appkey=xy_chat&_input_charset=utf-8";

interface TicketImageUploadRequest {
  withCredentials: boolean;
  timeout: number;
  status: number;
  responseText: string;
  onload: () => void;
  onerror: () => void;
  ontimeout: () => void;
  open(method: string, url: string, async: boolean): void;
  send(body: unknown): void;
}

interface TicketImageUploadFormData {
  append(name: string, value: Blob, filename: string): void;
}

interface TicketImageUploadDependencies {
  createRequest(): TicketImageUploadRequest;
  createFormData(): TicketImageUploadFormData;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

export function decodeGoofishTicketImageUploadResponse(
  value: unknown
): UploadedTicketImage {
  const response = record(value, "upload response");
  if (response.success !== true) {
    throw new Error("upload response.success must be true");
  }
  const object = record(response.object, "upload response.object");
  const url = nonEmptyString(object.url, "upload response.object.url");
  const pix = nonEmptyString(object.pix, "upload response.object.pix");
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(pix);
  if (match === null) {
    throw new Error("upload response.object.pix must be WIDTHxHEIGHT");
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new Error("upload response.object.pix dimensions must be safe integers");
  }
  return { url, width, height };
}

export function uploadGoofishTicketImage(
  file: Blob,
  dependencies: TicketImageUploadDependencies = {
    createRequest: () => new XMLHttpRequest() as unknown as TicketImageUploadRequest,
    createFormData: () => new FormData()
  }
): Promise<UploadedTicketImage> {
  const form = dependencies.createFormData();
  form.append("file", file, "image.jpg");

  return new Promise((resolve, reject) => {
    const request = dependencies.createRequest();
    request.open("POST", GOOFISH_TICKET_IMAGE_UPLOAD_URL, true);
    request.withCredentials = true;
    request.timeout = 30_000;
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`ticket image upload failed with HTTP ${request.status}`));
        return;
      }
      let response: unknown;
      try {
        response = JSON.parse(request.responseText);
      } catch {
        reject(new Error("ticket image upload response must be valid JSON"));
        return;
      }
      try {
        resolve(decodeGoofishTicketImageUploadResponse(response));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(new Error("ticket image upload network failed"));
    request.ontimeout = () => reject(new Error("ticket image upload timed out"));
    request.send(form);
  });
}
