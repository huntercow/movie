import type { UploadedTicketImage } from "./ticketDeliveryAutomation.ts";

export interface TicketImageMessageContent {
  contentType: 2;
  image: {
    pics: [{
      height: string;
      width: string;
      type: 0;
      url: string;
    }];
  };
}

export function createTicketImageMessageContent(
  image: UploadedTicketImage
): TicketImageMessageContent {
  return {
    contentType: 2,
    image: {
      pics: [{
        height: String(image.height),
        width: String(image.width),
        type: 0,
        url: image.url
      }]
    }
  };
}
