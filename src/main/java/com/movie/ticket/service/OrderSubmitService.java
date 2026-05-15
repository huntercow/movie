package com.movie.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import com.movie.ticket.upstream.PiaoDaRenSession;
import com.movie.ticket.upstream.SubmitOrderCommand;
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UpstreamCancelOrderResult;
import com.movie.ticket.upstream.UpstreamOrderDetailResult;
import com.movie.ticket.upstream.UpstreamPayOrderResult;
import com.movie.ticket.upstream.UpstreamSubmitOrderResult;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
public class OrderSubmitService {

    private final TicketOrderRepository orderRepository;
    private final TicketQuoteRepository quoteRepository;
    private final TicketUpstreamClient upstreamClient;
    private final PiaoDaRenSession session;
    private final ObjectMapper objectMapper;

    public OrderSubmitService(
            TicketOrderRepository orderRepository,
            TicketQuoteRepository quoteRepository,
            TicketUpstreamClient upstreamClient,
            PiaoDaRenSession session,
            ObjectMapper objectMapper
    ) {
        this.orderRepository = orderRepository;
        this.quoteRepository = quoteRepository;
        this.upstreamClient = upstreamClient;
        this.session = session;
        this.objectMapper = objectMapper;
    }

    @Async
    @Transactional
    public void submitAsync(String orderNo) {
        doSubmit(orderNo);
    }

    @Transactional
    public void repeatSubmitAndPay(String orderNo) {
        TicketOrder order = orderRepository.findByOrderNo(orderNo).orElseThrow();
        try {
            cancelPreviousIfPresent(order);
            order.setStatus(OrderStatus.WAIT_SUBMIT);
            order.setUpstreamOrderId(null);
            order.setUpstreamOrderNo(null);
            order.setUpstreamSubmitRequest(null);
            order.setUpstreamSubmitResponse(null);
            order.setUpstreamPayRequest(null);
            order.setUpstreamPayResponse(null);
            order.setSubmittedAt(null);
            order.setPaidAt(null);
            orderRepository.save(order);
            doSubmit(orderNo);
        } catch (Exception exception) {
            order.setLastSubmitError(exception.getMessage());
            order.setStatus(OrderStatus.SUBMIT_FAILED);
            orderRepository.save(order);
        }
    }

    private void doSubmit(String orderNo) {
        TicketOrder order = orderRepository.findByOrderNo(orderNo).orElseThrow();
        if (order.getStatus() != OrderStatus.WAIT_SUBMIT && order.getStatus() != OrderStatus.SUBMIT_FAILED) {
            return;
        }
        order.setStatus(OrderStatus.SUBMITTING);
        order.setSubmitRetryCount((order.getSubmitRetryCount() == null ? 0 : order.getSubmitRetryCount()) + 1);
        orderRepository.save(order);

        try {
            TicketQuote quote = quoteRepository.findByQuoteNo(order.getQuoteNo()).orElseThrow();
            UpstreamSubmitOrderResult result = upstreamClient.submitOrder(new SubmitOrderCommand(
                    session.getUserId(),
                    session.getUserName(),
                    quote.getShowId(),
                    parseSeats(quote.getSeatsJson()),
                    quote.getUpstreamPrice(),
                    quote.getOfficialQuotationId(),
                    quote.getOfficialQuotationChannel()
            ));
            order.setUpstreamOrderId(result.orderId());
            order.setUpstreamOrderNo(result.orderNumber());
            order.setUpstreamSubmitRequest(result.rawRequest());
            order.setUpstreamSubmitResponse(result.rawResponse());
            order.setLastSubmitError(null);
            order.setSubmittedAt(java.time.LocalDateTime.now());
            UpstreamPayOrderResult payResult = upstreamClient.payOrder(result.orderNumber());
            order.setUpstreamPayRequest(payResult.rawRequest());
            order.setUpstreamPayResponse(payResult.rawResponse());
            order.setPaidAt(java.time.LocalDateTime.now());
            UpstreamOrderDetailResult detailResult = upstreamClient.getOrderDetail(result.orderNumber());
            order.setUpstreamOrderId(detailResult.orderId());
            order.setStatus(OrderStatus.PAID);
        } catch (Exception exception) {
            order.setLastSubmitError(exception.getMessage());
            order.setStatus(OrderStatus.SUBMIT_FAILED);
        }
        orderRepository.save(order);
    }

    private void cancelPreviousIfPresent(TicketOrder order) {
        fillUpstreamOrderIdIfMissing(order);
        if (StringUtils.hasText(order.getUpstreamOrderNo()) && !StringUtils.hasText(order.getUpstreamOrderId())) {
            throw new BusinessException("cannot cancel previous upstream order without upstream order id");
        }
        if (!StringUtils.hasText(order.getUpstreamOrderId())) {
            return;
        }
        UpstreamCancelOrderResult cancelResult = upstreamClient.cancelOrder(order.getUpstreamOrderId());
        order.setUpstreamCancelRequest(cancelResult.rawRequest());
        order.setUpstreamCancelResponse(cancelResult.rawResponse());
        order.setCanceledAt(java.time.LocalDateTime.now());
        orderRepository.save(order);
    }

    private void fillUpstreamOrderIdIfMissing(TicketOrder order) {
        if (StringUtils.hasText(order.getUpstreamOrderId()) || !StringUtils.hasText(order.getUpstreamOrderNo())) {
            return;
        }
        UpstreamOrderDetailResult detailResult = upstreamClient.getOrderDetail(order.getUpstreamOrderNo());
        order.setUpstreamOrderId(detailResult.orderId());
        orderRepository.save(order);
    }

    private List<String> parseSeats(String seatsJson) {
        if (seatsJson == null || seatsJson.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(seatsJson, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            return List.of();
        }
    }
}
