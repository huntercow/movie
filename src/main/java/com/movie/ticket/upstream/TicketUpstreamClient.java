package com.movie.ticket.upstream;

import com.movie.ticket.dto.MovieTicketInfo;

public interface TicketUpstreamClient {
    UploadedImage uploadImage(String imageBase64);

    MovieTicketInfo recognizeTicket(String imageUrl);

    UpstreamQuote quote(MovieTicketInfo ticketInfo);

    UpstreamSubmitOrderResult submitOrder(SubmitOrderCommand command);

    UpstreamPayOrderResult payOrder(String orderNumber);

    UpstreamCancelOrderResult cancelOrder(String orderId);

    UpstreamOrderDetailResult getOrderDetail(String orderNumber);
}
