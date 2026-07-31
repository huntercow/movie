package com.movie.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import com.movie.ticket.upstream.PiaoDaRenSession;
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UpstreamPayOrderResult;
import com.movie.ticket.upstream.UpstreamSubmitOrderResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OrderSubmitServiceTest {

    private TicketOrderRepository orderRepository;
    private TicketQuoteRepository quoteRepository;
    private TicketUpstreamClient upstreamClient;
    private OrderSyncService orderSyncService;
    private OrderSubmitService service;

    @BeforeEach
    void setUp() {
        orderRepository = mock(TicketOrderRepository.class);
        quoteRepository = mock(TicketQuoteRepository.class);
        upstreamClient = mock(TicketUpstreamClient.class);
        PiaoDaRenSession session = mock(PiaoDaRenSession.class);
        PricingService pricingService = mock(PricingService.class);
        orderSyncService = mock(OrderSyncService.class);
        when(session.getUserId()).thenReturn("upstream-user-id");
        when(session.getUserName()).thenReturn("upstream-user");
        when(orderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(orderRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        service = new OrderSubmitService(
                orderRepository,
                quoteRepository,
                upstreamClient,
                session,
                new ObjectMapper(),
                pricingService,
                orderSyncService
        );
    }

    @Test
    void payFailureKeepsSubmitCheckpointAndResumeDoesNotSubmitAgain() {
        TicketOrder order = order(OrderStatus.WAIT_SUBMIT);
        TicketQuote quote = quote();
        when(orderRepository.findByOrderNoForUpdate("O1")).thenReturn(Optional.of(order));
        when(quoteRepository.findByQuoteNo("Q1")).thenReturn(Optional.of(quote));
        when(upstreamClient.submitOrder(any())).thenReturn(new UpstreamSubmitOrderResult(
                "upstream-id",
                "upstream-no",
                "submit-request",
                "submit-response"
        ));
        when(upstreamClient.payOrder("upstream-no"))
                .thenThrow(new BusinessException("pay timeout"))
                .thenReturn(new UpstreamPayOrderResult("upstream-no", "pay-request", "pay-response"));

        assertThatThrownBy(() -> service.processInitialSubmit("O1"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("pay timeout");

        assertThat(order.getStatus()).isEqualTo(OrderStatus.SUBMITTED);
        assertThat(order.getUpstreamOrderNo()).isEqualTo("upstream-no");
        assertThat(order.getPaidAt()).isNull();
        assertThat(order.getLastSubmitError()).contains("pay timeout");

        AtomicInteger syncCalls = new AtomicInteger();
        when(orderSyncService.syncOrder("O1")).thenAnswer(invocation -> {
            order.setStatus(syncCalls.getAndIncrement() == 0 ? OrderStatus.WAIT_PAY : OrderStatus.TICKETING);
            return order;
        });

        service.resumeSubmitAndPay("O1");

        assertThat(order.getStatus()).isEqualTo(OrderStatus.TICKETING);
        assertThat(order.getPaidAt()).isNotNull();
        assertThat(order.getLastSubmitError()).isNull();
        verify(upstreamClient, times(1)).submitOrder(any());
        verify(upstreamClient, times(2)).payOrder("upstream-no");
    }

    @Test
    void retryWithoutKnownUpstreamOrderIsRejected() {
        TicketOrder order = order(OrderStatus.SUBMIT_FAILED);
        order.setSubmitRetryCount(1);
        when(orderRepository.findByOrderNoForUpdate("O1")).thenReturn(Optional.of(order));

        assertThatThrownBy(() -> service.resumeSubmitAndPay("O1"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("cannot safely retry");
        verify(upstreamClient, never()).submitOrder(any());
    }

    @Test
    void repeatWithUnknownPreviousOutcomeRequiresForce() {
        TicketOrder order = order(OrderStatus.SUBMIT_FAILED);
        order.setSubmitRetryCount(1);
        when(orderRepository.findByOrderNoForUpdate("O1")).thenReturn(Optional.of(order));

        assertThatThrownBy(() -> service.repeatSubmitAndPay("O1", false))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("force=true");
        verify(upstreamClient, never()).submitOrder(any());
    }

    @Test
    void duplicateInitialDispatchDoesNotCreateAnotherUpstreamOrder() {
        TicketOrder order = order(OrderStatus.WAIT_SUBMIT);
        when(orderRepository.findByOrderNoForUpdate("O1")).thenReturn(Optional.of(order));
        when(quoteRepository.findByQuoteNo("Q1")).thenReturn(Optional.of(quote()));
        when(upstreamClient.submitOrder(any())).thenReturn(new UpstreamSubmitOrderResult(
                "upstream-id", "upstream-no", "request", "response"
        ));
        when(upstreamClient.payOrder("upstream-no")).thenReturn(new UpstreamPayOrderResult(
                "upstream-no", "request", "response"
        ));
        when(orderSyncService.syncOrder("O1")).thenAnswer(invocation -> {
            order.setStatus(OrderStatus.TICKETING);
            return order;
        });

        service.processInitialSubmit("O1");
        service.processInitialSubmit("O1");

        verify(upstreamClient, times(1)).submitOrder(any());
        verify(upstreamClient, times(1)).payOrder("upstream-no");
    }

    private TicketOrder order(OrderStatus status) {
        TicketOrder order = new TicketOrder();
        order.setOrderNo("O1");
        order.setQuoteNo("Q1");
        order.setCustomerId("customer-1");
        order.setFinalPrice(new BigDecimal("29.19"));
        order.setTotalPrice(new BigDecimal("58.38"));
        order.setSubmitRetryCount(0);
        order.setStatus(status);
        return order;
    }

    private TicketQuote quote() {
        TicketQuote quote = new TicketQuote();
        quote.setQuoteNo("Q1");
        quote.setShowId("show-1");
        quote.setSeatsJson("[\"5排6座\",\"5排7座\"]");
        quote.setUpstreamPrice(new BigDecimal("27.66"));
        quote.setOfficialQuotationId("quote-task");
        quote.setOfficialQuotationChannel("LIMIT_PRICE");
        return quote;
    }
}
