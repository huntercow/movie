package com.movie.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import com.movie.ticket.upstream.PiaoDaRenSession;
import com.movie.ticket.upstream.SubmitOrderCommand;
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UpstreamSubmitOrderResult;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
            order.setUpstreamOrderNo(result.orderNumber());
            order.setUpstreamSubmitRequest(result.rawRequest());
            order.setUpstreamSubmitResponse(result.rawResponse());
            order.setLastSubmitError(null);
            order.setSubmittedAt(java.time.LocalDateTime.now());
            order.setStatus(OrderStatus.SUBMITTED);
        } catch (Exception exception) {
            order.setLastSubmitError(exception.getMessage());
            order.setStatus(OrderStatus.SUBMIT_FAILED);
        }
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
