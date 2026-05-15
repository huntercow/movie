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
import com.movie.ticket.upstream.PiaoDaRenSession;
import com.movie.ticket.upstream.SubmitOrderCommand;
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UpstreamCancelOrderResult;
import com.movie.ticket.upstream.UpstreamOrderDetailResult;
import com.movie.ticket.upstream.UpstreamPayOrderResult;
import com.movie.ticket.upstream.UpstreamQuote;
import com.movie.ticket.upstream.UpstreamSubmitOrderResult;
import org.springframework.scheduling.annotation.Async;
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

    public OrderSubmitService(
            TicketOrderRepository orderRepository,
            TicketQuoteRepository quoteRepository,
            TicketUpstreamClient upstreamClient,
            PiaoDaRenSession session,
            ObjectMapper objectMapper,
            PricingService pricingService
    ) {
        this.orderRepository = orderRepository;
        this.quoteRepository = quoteRepository;
        this.upstreamClient = upstreamClient;
        this.session = session;
        this.objectMapper = objectMapper;
        this.pricingService = pricingService;
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
            TicketQuote quote = quoteRepository.findByQuoteNo(order.getQuoteNo()).orElseThrow();
            refreshQuoteBeforeRepeat(order, quote);
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

    private void refreshQuoteBeforeRepeat(TicketOrder order, TicketQuote quote) {
        UpstreamQuote upstreamQuote = upstreamClient.quote(toMovieTicketInfo(quote));
        BigDecimal maxPrice = parsePrice(quote.getMaxPrice(), "invalid max price from quote");
        BigDecimal finalPrice = pricingService.calculateFinalPrice(upstreamQuote.price(), maxPrice);
        int ticketCount = ticketCount(quote.getSeatCount());
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
            return List.of();
        }
        try {
            return objectMapper.readValue(seatsJson, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            return List.of();
        }
    }

    private Map<String, String> parseSeatsAndPrice(String seatsAndPriceJson) {
        if (seatsAndPriceJson == null || seatsAndPriceJson.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(seatsAndPriceJson, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }

    private BigDecimal parsePrice(String value, String message) {
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException exception) {
            throw new BusinessException(message);
        }
    }

    private int ticketCount(Integer seatCount) {
        return seatCount == null || seatCount <= 0 ? 1 : seatCount;
    }
}
