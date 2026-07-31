package com.movie.ticket.service;

import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.QuoteStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.job.OrderJobService;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import com.movie.ticket.security.UserScopeContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
public class OrderService {

    private final QuoteService quoteService;
    private final TicketQuoteRepository quoteRepository;
    private final TicketOrderRepository orderRepository;
    private final OrderJobService orderJobService;

    public OrderService(
            QuoteService quoteService,
            TicketQuoteRepository quoteRepository,
            TicketOrderRepository orderRepository,
            OrderJobService orderJobService
    ) {
        this.quoteService = quoteService;
        this.quoteRepository = quoteRepository;
        this.orderRepository = orderRepository;
        this.orderJobService = orderJobService;
    }

    @Transactional
    public OrderResponse createOrder(CreateOrderRequest request) {
        Long userId = UserScopeContext.get();
        TicketOrder existingQuoteOrder = (userId == null
                ? orderRepository.findByQuoteNo(request.quoteNo())
                : orderRepository.findByUserIdAndQuoteNo(userId, request.quoteNo())).orElse(null);
        if (existingQuoteOrder != null) {
            if (!request.customerId().equals(existingQuoteOrder.getCustomerId())) {
                throw new BusinessException("quote already belongs to another order customer");
            }
            return toResponse(existingQuoteOrder);
        }
        if (StringUtils.hasText(request.paymentNo())) {
            TicketOrder existingOrder = (userId == null
                    ? orderRepository.findByPaymentNo(request.paymentNo())
                    : orderRepository.findByUserIdAndPaymentNo(userId, request.paymentNo())).orElse(null);
            if (existingOrder != null) {
                if (!request.quoteNo().equals(existingOrder.getQuoteNo())
                        || !request.customerId().equals(existingOrder.getCustomerId())) {
                    throw new BusinessException("payment reference already belongs to another order");
                }
                return toResponse(existingOrder);
            }
        }
        TicketQuote quote = quoteService.requireQuoteForUpdate(request.quoteNo());
        if (quote.getStatus() != QuoteStatus.CREATED) {
            throw new BusinessException("quote status cannot create order");
        }
        if (StringUtils.hasText(quote.getCustomerId()) && !quote.getCustomerId().equals(request.customerId())) {
            throw new BusinessException("quote does not belong to current customer");
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
        orderJobService.enqueueOrderSubmit(order.getOrderNo());
        return toResponse(order);
    }

    public OrderResponse getOrder(String orderNo) {
        Long userId = UserScopeContext.get();
        return (userId == null
                ? orderRepository.findByOrderNo(orderNo)
                : orderRepository.findByUserIdAndOrderNo(userId, orderNo))
                .map(this::toResponse)
                .orElseThrow(() -> new BusinessException("order not found"));
    }

    public java.util.Optional<OrderResponse> findOrderByQuoteNo(String quoteNo) {
        Long userId = UserScopeContext.get();
        return (userId == null
                ? orderRepository.findByQuoteNo(quoteNo)
                : orderRepository.findByUserIdAndQuoteNo(userId, quoteNo)).map(this::toResponse);
    }

    public java.util.List<OrderResponse> listCurrentUserOrders() {
        Long userId = UserScopeContext.get();
        if (userId == null) {
            throw new BusinessException("user context is required");
        }
        return orderRepository.findTop100ByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(this::toResponse)
                .toList();
    }

    public java.util.List<OrderResponse> listAllOrdersForAdmin() {
        return orderRepository.findTop200ByOrderByCreatedAtDesc().stream()
                .map(this::toResponse)
                .toList();
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

}
