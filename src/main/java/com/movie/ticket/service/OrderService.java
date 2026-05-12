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

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
public class OrderService {

    private final QuoteService quoteService;
    private final TicketQuoteRepository quoteRepository;
    private final TicketOrderRepository orderRepository;

    public OrderService(QuoteService quoteService, TicketQuoteRepository quoteRepository, TicketOrderRepository orderRepository) {
        this.quoteService = quoteService;
        this.quoteRepository = quoteRepository;
        this.orderRepository = orderRepository;
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
        order.setStatus(OrderStatus.CREATED);
        orderRepository.save(order);

        quote.setStatus(QuoteStatus.ORDERED);
        quoteRepository.save(quote);
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
                order.getStatus().name()
        );
    }

    private String newOrderNo() {
        return "O" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(LocalDateTime.now())
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }
}
