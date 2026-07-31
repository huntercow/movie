package com.movie.ticket.service;

import com.movie.ticket.dto.BotCreateOrderRequest;
import com.movie.ticket.dto.BotImageQuoteRequest;
import com.movie.ticket.dto.BotPaymentConfirmRequest;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.dto.QuoteResponse;
import com.movie.ticket.entity.BotMessage;
import com.movie.ticket.entity.Customer;
import com.movie.ticket.entity.PaymentRecord;
import com.movie.ticket.entity.PaymentStatus;
import com.movie.ticket.entity.QuoteStatus;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.repository.BotMessageRepository;
import com.movie.ticket.repository.CustomerRepository;
import com.movie.ticket.repository.PaymentRecordRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BotServiceTest {

    private CustomerRepository customerRepository;
    private BotMessageRepository botMessageRepository;
    private PaymentRecordRepository paymentRecordRepository;
    private QuoteService quoteService;
    private OrderService orderService;
    private BotService service;

    @BeforeEach
    void setUp() {
        customerRepository = mock(CustomerRepository.class);
        botMessageRepository = mock(BotMessageRepository.class);
        paymentRecordRepository = mock(PaymentRecordRepository.class);
        quoteService = mock(QuoteService.class);
        orderService = mock(OrderService.class);
        service = new BotService(
                customerRepository,
                botMessageRepository,
                paymentRecordRepository,
                quoteService,
                orderService
        );
    }

    @Test
    void duplicateImageMessageReturnsOriginalQuote() {
        Customer customer = customer();
        BotMessage message = new BotMessage();
        message.setWechatId("wx-1");
        message.setMessageId("msg-1");
        message.setCustomerNo("C1");
        message.setQuoteNo("Q1");
        when(customerRepository.findByWechatIdForUpdate("wx-1")).thenReturn(Optional.of(customer));
        when(customerRepository.save(customer)).thenReturn(customer);
        when(botMessageRepository.findByWechatIdAndMessageId("wx-1", "msg-1")).thenReturn(Optional.of(message));
        when(quoteService.getQuote("Q1")).thenReturn(quoteResponse());

        var response = service.createQuoteFromImage(new BotImageQuoteRequest(
                "wx-1", "buyer", null, "msg-1", "base64"
        ));

        assertThat(response.duplicated()).isTrue();
        assertThat(response.quote().quoteNo()).isEqualTo("Q1");
        verify(quoteService, never()).createQuote(any());
    }

    @Test
    void duplicateExternalPaymentNumberReturnsOriginalConfirmation() {
        Customer customer = customer();
        TicketQuote quote = quoteEntity();
        PaymentRecord payment = payment();
        when(customerRepository.findByWechatIdForUpdate("wx-1")).thenReturn(Optional.of(customer));
        when(quoteService.requireQuote("Q1")).thenReturn(quote);
        when(paymentRecordRepository.findByPaymentNo("wx-pay-1")).thenReturn(Optional.of(payment));

        var response = service.confirmPayment(new BotPaymentConfirmRequest(
                "wx-1", "Q1", new BigDecimal("88.00"), "wx-pay-1", null, "operator", null
        ));

        assertThat(response.paymentRecordNo()).isEqualTo("P1");
        verify(paymentRecordRepository, never()).save(any());
    }

    @Test
    void duplicateCreateOrderForQuoteReturnsExistingOrder() {
        Customer customer = customer();
        TicketQuote quote = quoteEntity();
        OrderResponse existingOrder = orderResponse();
        when(customerRepository.findByWechatIdForUpdate("wx-1")).thenReturn(Optional.of(customer));
        when(quoteService.requireQuote("Q1")).thenReturn(quote);
        when(orderService.findOrderByQuoteNo("Q1")).thenReturn(Optional.of(existingOrder));

        var response = service.createOrderAfterPayment(new BotCreateOrderRequest("wx-1", "Q1", "P1"));

        assertThat(response.orderNo()).isEqualTo("O1");
        verify(paymentRecordRepository, never()).findByPaymentRecordNo(any());
        verify(orderService, never()).createOrder(any());
    }

    private Customer customer() {
        Customer customer = new Customer();
        customer.setCustomerNo("C1");
        customer.setWechatId("wx-1");
        customer.setLatestQuoteNo("Q1");
        return customer;
    }

    private TicketQuote quoteEntity() {
        TicketQuote quote = new TicketQuote();
        quote.setQuoteNo("Q1");
        quote.setCustomerId("C1");
        quote.setTotalPrice(new BigDecimal("88.00"));
        quote.setStatus(QuoteStatus.CREATED);
        return quote;
    }

    private PaymentRecord payment() {
        PaymentRecord payment = new PaymentRecord();
        payment.setPaymentRecordNo("P1");
        payment.setPaymentNo("wx-pay-1");
        payment.setCustomerNo("C1");
        payment.setQuoteNo("Q1");
        payment.setAmount(new BigDecimal("88.00"));
        payment.setStatus(PaymentStatus.CONFIRMED);
        return payment;
    }

    private QuoteResponse quoteResponse() {
        return new QuoteResponse(
                "Q1",
                new MovieTicketInfo(
                        "task", "province", "city", "area", "code", "cinema-id", "cinema-code", "address",
                        "film-id", "film.jpg", 1, "show-id", "movie", "cinema", LocalDateTime.now().plusDays(1),
                        "hall", "2D", 1, List.of("1排1座"), Map.of("1排1座", "88.00"), "88.00", "88.00", "image.jpg"
                ),
                new BigDecimal("66.00"),
                new BigDecimal("88.00"),
                new BigDecimal("88.00"),
                new BigDecimal("22.00"),
                "CREATED"
        );
    }

    private OrderResponse orderResponse() {
        return new OrderResponse(
                "O1", "Q1", "C1", new BigDecimal("88.00"), new BigDecimal("88.00"),
                "upstream-id", "upstream-no", 4, null, 1, null, null,
                "TICKETING", "出票中", false, true
        );
    }
}
