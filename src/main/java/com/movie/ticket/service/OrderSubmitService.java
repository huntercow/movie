package com.movie.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import com.movie.ticket.security.UserScopeContext;
import com.movie.ticket.upstream.PiaoDaRenSession;
import com.movie.ticket.upstream.SubmitOrderCommand;
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UpstreamCancelOrderResult;
import com.movie.ticket.upstream.UpstreamOrderDetailResult;
import com.movie.ticket.upstream.UpstreamPayOrderResult;
import com.movie.ticket.upstream.UpstreamQuote;
import com.movie.ticket.upstream.UpstreamSubmitOrderResult;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@Service
public class OrderSubmitService {

    private final TicketOrderRepository orderRepository;
    private final TicketQuoteRepository quoteRepository;
    private final TicketUpstreamClient upstreamClient;
    private final PiaoDaRenSession session;
    private final ObjectMapper objectMapper;
    private final PricingService pricingService;
    private final OrderSyncService orderSyncService;

    public OrderSubmitService(
            TicketOrderRepository orderRepository,
            TicketQuoteRepository quoteRepository,
            TicketUpstreamClient upstreamClient,
            PiaoDaRenSession session,
            ObjectMapper objectMapper,
            PricingService pricingService,
            OrderSyncService orderSyncService
    ) {
        this.orderRepository = orderRepository;
        this.quoteRepository = quoteRepository;
        this.upstreamClient = upstreamClient;
        this.session = session;
        this.objectMapper = objectMapper;
        this.pricingService = pricingService;
        this.orderSyncService = orderSyncService;
    }

    @Transactional(noRollbackFor = BusinessException.class)
    public void processInitialSubmit(String orderNo) {
        TicketOrder order = requireOrderForUpdate(orderNo);
        if (order.getStatus() != OrderStatus.WAIT_SUBMIT) {
            return;
        }
        runSubmitStateMachine(order, true);
    }

    @Transactional(noRollbackFor = BusinessException.class)
    public void resumeSubmitAndPay(String orderNo) {
        TicketOrder order = requireOrderForUpdate(orderNo);
        if (!StringUtils.hasText(order.getUpstreamOrderNo())) {
            throw new BusinessException(
                    "cannot safely retry without an upstream order number; verify the upstream order list, then use repeat with force=true"
            );
        }
        if (isTerminal(order.getStatus())) {
            throw new BusinessException("terminal order cannot resume upstream submission");
        }
        runSubmitStateMachine(order, false);
    }

    @Transactional(noRollbackFor = BusinessException.class)
    public void repeatSubmitAndPay(String orderNo, boolean force) {
        TicketOrder order = requireOrderForUpdate(orderNo);
        if (!StringUtils.hasText(order.getUpstreamOrderNo())
                && order.getSubmitRetryCount() != null
                && order.getSubmitRetryCount() > 0
                && !force) {
            throw new BusinessException(
                    "previous submit outcome is unknown; verify the upstream order list before repeating, then set force=true"
            );
        }
        try {
            cancelPreviousIfPresent(order);
            TicketQuote quote = requireQuote(order.getQuoteNo());
            refreshQuoteBeforeRepeat(order, quote);
            order.setStatus(OrderStatus.WAIT_SUBMIT);
            order.setUpstreamOrderId(null);
            order.setUpstreamOrderNo(null);
            order.setUpstreamSubmitRequest(null);
            order.setUpstreamSubmitResponse(null);
            order.setUpstreamPayRequest(null);
            order.setUpstreamPayResponse(null);
            order.setUpstreamDetailResponse(null);
            order.setUpstreamOrderStatus(null);
            order.setTicketCodeInfo(null);
            order.setSubmittedAt(null);
            order.setPaidAt(null);
            order.setLastSubmitError(null);
            order.setLastSyncError(null);
            order.setLastSyncAt(null);
            order.setIssuedAt(null);
            order.setRefundedAt(null);
            orderRepository.save(order);
        } catch (BusinessException exception) {
            order.setLastSubmitError(exception.getMessage());
            order.setStatus(OrderStatus.SUBMIT_FAILED);
            orderRepository.save(order);
            throw exception;
        }
        runSubmitStateMachine(order, true);
    }

    private void runSubmitStateMachine(TicketOrder order, boolean allowNewSubmit) {
        order.setStatus(OrderStatus.SUBMITTING);
        order.setSubmitRetryCount((order.getSubmitRetryCount() == null ? 0 : order.getSubmitRetryCount()) + 1);
        orderRepository.saveAndFlush(order);

        try {
            TicketQuote quote = requireQuote(order.getQuoteNo());
            boolean submittedNow = false;
            if (!StringUtils.hasText(order.getUpstreamOrderNo())) {
                if (!allowNewSubmit) {
                    throw new BusinessException("upstream order number is required to resume");
                }
                submitNewUpstreamOrder(order, quote);
                submittedNow = true;
            }

            if (order.getPaidAt() == null) {
                if (!submittedNow && !prepareKnownOrderForPayment(order)) {
                    order.setLastSubmitError(null);
                    orderRepository.save(order);
                    return;
                }
                payKnownUpstreamOrder(order);
            }

            order.setLastSubmitError(null);
            syncAfterPayment(order);
        } catch (BusinessException exception) {
            order.setLastSubmitError(exception.getMessage());
            if (!StringUtils.hasText(order.getUpstreamOrderNo())) {
                order.setStatus(OrderStatus.SUBMIT_FAILED);
            } else if (order.getPaidAt() != null) {
                order.setStatus(OrderStatus.PAID);
            } else if (order.getStatus() == OrderStatus.SUBMITTING) {
                order.setStatus(OrderStatus.SUBMITTED);
            }
            orderRepository.save(order);
            throw exception;
        }
    }

    private void submitNewUpstreamOrder(TicketOrder order, TicketQuote quote) {
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
        order.setStatus(OrderStatus.SUBMITTED);
        orderRepository.saveAndFlush(order);
    }

    private boolean prepareKnownOrderForPayment(TicketOrder order) {
        orderSyncService.syncOrder(order.getOrderNo());
        if (order.getStatus() == OrderStatus.WAIT_PAY) {
            return true;
        }
        return switch (order.getStatus()) {
            case PAID, TICKETING, ISSUED, REFUNDED -> false;
            default -> throw new BusinessException(
                    "upstream order is not in a payable state: " + order.getStatus()
            );
        };
    }

    private void payKnownUpstreamOrder(TicketOrder order) {
        UpstreamPayOrderResult payResult = upstreamClient.payOrder(order.getUpstreamOrderNo());
        order.setUpstreamPayRequest(payResult.rawRequest());
        order.setUpstreamPayResponse(payResult.rawResponse());
        order.setPaidAt(java.time.LocalDateTime.now());
        order.setStatus(OrderStatus.PAID);
        orderRepository.saveAndFlush(order);
    }

    private void syncAfterPayment(TicketOrder order) {
        try {
            orderSyncService.syncOrder(order.getOrderNo());
        } catch (BusinessException syncException) {
            order.setLastSyncError(syncException.getMessage());
            orderRepository.save(order);
            throw syncException;
        }
    }

    private TicketOrder requireOrderForUpdate(String orderNo) {
        Long userId = UserScopeContext.get();
        return (userId == null
                ? orderRepository.findByOrderNoForUpdate(orderNo)
                : orderRepository.findByUserIdAndOrderNoForUpdate(userId, orderNo))
                .orElseThrow(() -> new BusinessException("order not found"));
    }

    private TicketQuote requireQuote(String quoteNo) {
        Long userId = UserScopeContext.get();
        return (userId == null
                ? quoteRepository.findByQuoteNo(quoteNo)
                : quoteRepository.findByUserIdAndQuoteNo(userId, quoteNo))
                .orElseThrow(() -> new BusinessException("quote not found"));
    }

    private boolean isTerminal(OrderStatus status) {
        return status == OrderStatus.ISSUED
                || status == OrderStatus.REFUNDED
                || status == OrderStatus.FAILED;
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

    private void refreshQuoteBeforeRepeat(TicketOrder order, TicketQuote quote) {
        UpstreamQuote upstreamQuote = upstreamClient.quote(toMovieTicketInfo(quote));
        BigDecimal maxPrice = parsePrice(quote.getMaxPrice(), "invalid max price from quote");
        BigDecimal finalPrice = pricingService.calculateFinalPrice(upstreamQuote.price(), maxPrice);
        int ticketCount = requireTicketCount(quote.getSeatCount());
        BigDecimal totalPrice = finalPrice.multiply(BigDecimal.valueOf(ticketCount));
        BigDecimal totalProfit = finalPrice.subtract(upstreamQuote.price()).multiply(BigDecimal.valueOf(ticketCount));

        quote.setUpstreamPrice(upstreamQuote.price());
        quote.setFinalPrice(finalPrice);
        quote.setTotalPrice(totalPrice);
        quote.setProfit(totalProfit);
        quote.setUpstreamRawResponse(upstreamQuote.rawResponse());
        quote.setOfficialQuotationId(upstreamQuote.taskId());
        quote.setOfficialQuotationChannel(upstreamQuote.selectedChannel());
        quoteRepository.save(quote);

        order.setFinalPrice(finalPrice);
        order.setTotalPrice(totalPrice);
        orderRepository.save(order);
    }

    private MovieTicketInfo toMovieTicketInfo(TicketQuote quote) {
        return new MovieTicketInfo(
                quote.getOcrTaskId(),
                quote.getProvinceName(),
                quote.getCityName(),
                quote.getAreaName(),
                quote.getCityCode(),
                quote.getCinemaId(),
                quote.getCinemaCode(),
                quote.getCinemaAddress(),
                quote.getFilmId(),
                quote.getFilmImg(),
                quote.getCustomFilmType(),
                quote.getShowId(),
                quote.getMovieName(),
                quote.getCinemaName(),
                quote.getShowTime(),
                quote.getHallName(),
                quote.getPlanType(),
                quote.getSeatCount(),
                parseSeats(quote.getSeatsJson()),
                parseSeatsAndPrice(quote.getSeatsAndPriceJson()),
                quote.getMaxPrice(),
                quote.getTotalImagePrice(),
                quote.getImageUrl()
        );
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
            throw new BusinessException("stored quote seats JSON is missing");
        }
        try {
            return objectMapper.readValue(seatsJson, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            throw new BusinessException("stored quote seats JSON is invalid", exception);
        }
    }

    private Map<String, String> parseSeatsAndPrice(String seatsAndPriceJson) {
        if (seatsAndPriceJson == null || seatsAndPriceJson.isBlank()) {
            throw new BusinessException("stored quote seat prices JSON is missing");
        }
        try {
            return objectMapper.readValue(seatsAndPriceJson, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            throw new BusinessException("stored quote seat prices JSON is invalid", exception);
        }
    }

    private BigDecimal parsePrice(String value, String message) {
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException exception) {
            throw new BusinessException(message);
        }
    }

    private int requireTicketCount(Integer seatCount) {
        if (seatCount == null || seatCount <= 0) {
            throw new BusinessException("stored quote has invalid seat count");
        }
        return seatCount;
    }
}
