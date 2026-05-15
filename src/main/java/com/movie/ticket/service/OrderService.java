package com.movie.ticket.service;

import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.QuoteStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
public class OrderService {

    private final QuoteService quoteService;
    private final TicketQuoteRepository quoteRepository;
    private final TicketOrderRepository orderRepository;
    private final OrderSubmitService orderSubmitService;

    public OrderService(
            QuoteService quoteService,
            TicketQuoteRepository quoteRepository,
            TicketOrderRepository orderRepository,
            OrderSubmitService orderSubmitService
    ) {
        this.quoteService = quoteService;
        this.quoteRepository = quoteRepository;
        this.orderRepository = orderRepository;
        this.orderSubmitService = orderSubmitService;
    }

    @Transactional
    public OrderResponse createOrder(CreateOrderRequest request) {
        TicketQuote quote = quoteService.requireQuote(request.quoteNo());
        if (quote.getStatus() != QuoteStatus.CREATED) {
            throw new BusinessException("quote status cannot create order");
        }
        TicketOrder order = new TicketOrder();
        order.setOrderNo(newOrderNo());
        order.setQuoteNo(quote.getQuoteNo());
        order.setCustomerId(request.customerId());
        order.setPaymentNo(request.paymentNo());
        order.setFinalPrice(quote.getFinalPrice());
        order.setTotalPrice(quote.getTotalPrice());
        order.setSubmitRetryCount(0);
        order.setStatus(OrderStatus.WAIT_SUBMIT);
        orderRepository.save(order);

        quote.setStatus(QuoteStatus.ORDERED);
        quoteRepository.save(quote);
        submitAfterCommit(order.getOrderNo());
        return toResponse(order);
    }

    public OrderResponse getOrder(String orderNo) {
        return orderRepository.findByOrderNo(orderNo)
                .map(this::toResponse)
                .orElseThrow(() -> new BusinessException("order not found"));
    }

    private OrderResponse toResponse(TicketOrder order) {
        return new OrderResponse(
                order.getOrderNo(),
                order.getQuoteNo(),
                order.getCustomerId(),
                order.getFinalPrice(),
                order.getTotalPrice(),
                order.getUpstreamOrderId(),
                order.getUpstreamOrderNo(),
                order.getUpstreamOrderStatus(),
                order.getTicketCodeInfo(),
                order.getSubmitRetryCount(),
                order.getLastSubmitError(),
                order.getLastSyncError(),
                order.getStatus().name(),
                statusText(order.getStatus()),
                isTerminal(order.getStatus()),
                shouldPoll(order.getStatus())
        );
    }

    private String statusText(OrderStatus status) {
        if (status == null) {
            return "\u672a\u77e5";
        }
        return switch (status) {
            case CREATED -> "\u5df2\u521b\u5efa";
            case WAIT_SUBMIT -> "\u7b49\u5f85\u63d0\u4ea4\u4e0a\u6e38";
            case SUBMITTING -> "\u63d0\u4ea4\u4e0a\u6e38\u4e2d";
            case SUBMITTED -> "\u5df2\u63d0\u4ea4\u4e0a\u6e38";
            case SUBMIT_FAILED -> "\u63d0\u4ea4\u5931\u8d25";
            case WAIT_PAY -> "\u7b49\u5f85\u652f\u4ed8";
            case PAID -> "\u5df2\u652f\u4ed8";
            case TICKETING -> "\u51fa\u7968\u4e2d";
            case ISSUED -> "\u5df2\u51fa\u7968";
            case FAILED -> "\u51fa\u7968\u5931\u8d25";
            case REFUNDED -> "\u5df2\u9000\u6b3e";
        };
    }

    private boolean isTerminal(OrderStatus status) {
        return status == OrderStatus.ISSUED
                || status == OrderStatus.REFUNDED
                || status == OrderStatus.FAILED
                || status == OrderStatus.SUBMIT_FAILED;
    }

    private boolean shouldPoll(OrderStatus status) {
        return !isTerminal(status);
    }

    private String newOrderNo() {
        return "O" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(LocalDateTime.now())
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }

    private void submitAfterCommit(String orderNo) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                orderSubmitService.submitAsync(orderNo);
            }
        });
    }
}
