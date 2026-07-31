package com.movie.ticket.service;

import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.entity.OrderStatus;
import com.movie.ticket.entity.QuoteStatus;
import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.job.OrderJobService;
import com.movie.ticket.repository.TicketOrderRepository;
import com.movie.ticket.repository.TicketQuoteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OrderServiceTest {

    private QuoteService quoteService;
    private TicketOrderRepository orderRepository;
    private OrderJobService orderJobService;
    private OrderService service;

    @BeforeEach
    void setUp() {
        quoteService = mock(QuoteService.class);
        TicketQuoteRepository quoteRepository = mock(TicketQuoteRepository.class);
        orderRepository = mock(TicketOrderRepository.class);
        orderJobService = mock(OrderJobService.class);
        service = new OrderService(quoteService, quoteRepository, orderRepository, orderJobService);
    }

    @Test
    void samePaymentReferenceReturnsExistingOrder() {
        TicketOrder existing = new TicketOrder();
        existing.setOrderNo("O1");
        existing.setQuoteNo("Q1");
        existing.setCustomerId("customer-1");
        existing.setPaymentNo("payment-1");
        existing.setFinalPrice(new BigDecimal("29.19"));
        existing.setTotalPrice(new BigDecimal("58.38"));
        existing.setSubmitRetryCount(1);
        existing.setStatus(OrderStatus.PAID);
        when(orderRepository.findByPaymentNo("payment-1")).thenReturn(Optional.of(existing));

        var response = service.createOrder(new CreateOrderRequest("Q1", "customer-1", "payment-1"));

        assertThat(response.orderNo()).isEqualTo("O1");
        verify(quoteService, never()).requireQuoteForUpdate("Q1");
        verify(orderJobService, never()).enqueueOrderSubmit("O1");
    }

    @Test
    void lockedQuoteCannotBeUsedByAnotherCustomer() {
        TicketQuote quote = new TicketQuote();
        quote.setQuoteNo("Q1");
        quote.setCustomerId("customer-1");
        quote.setStatus(QuoteStatus.CREATED);
        when(orderRepository.findByPaymentNo("payment-2")).thenReturn(Optional.empty());
        when(quoteService.requireQuoteForUpdate("Q1")).thenReturn(quote);

        assertThatThrownBy(() -> service.createOrder(new CreateOrderRequest("Q1", "customer-2", "payment-2")))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("does not belong");
        verify(orderRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }
}
