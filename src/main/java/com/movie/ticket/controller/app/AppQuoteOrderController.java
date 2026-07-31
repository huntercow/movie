package com.movie.ticket.controller.app;

import com.movie.ticket.audit.AuditService;
import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.CreateQuoteRequest;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.dto.QuoteResponse;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.security.CurrentUser;
import com.movie.ticket.service.OrderService;
import com.movie.ticket.service.QuoteService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/app")
public class AppQuoteOrderController {

    private final QuoteService quoteService;
    private final OrderService orderService;
    private final CurrentUser currentUser;
    private final AuditService auditService;

    public AppQuoteOrderController(
            QuoteService quoteService,
            OrderService orderService,
            CurrentUser currentUser,
            AuditService auditService
    ) {
        this.quoteService = quoteService;
        this.orderService = orderService;
        this.currentUser = currentUser;
        this.auditService = auditService;
    }

    @GetMapping("/quotes")
    public ApiResponse<List<QuoteResponse>> listQuotes() {
        return ApiResponse.ok(quoteService.listCurrentUserQuotes());
    }

    @PostMapping("/quotes")
    public ApiResponse<QuoteResponse> createQuote(@Valid @RequestBody CreateQuoteRequest request) {
        requireChangedPassword();
        return ApiResponse.ok(quoteService.createQuote(request));
    }

    @GetMapping("/quotes/{quoteNo}")
    public ApiResponse<QuoteResponse> getQuote(@PathVariable String quoteNo) {
        return ApiResponse.ok(quoteService.getQuote(quoteNo));
    }

    @GetMapping("/orders")
    public ApiResponse<List<OrderResponse>> listOrders() {
        return ApiResponse.ok(orderService.listCurrentUserOrders());
    }

    @GetMapping("/orders/{orderNo}")
    public ApiResponse<OrderResponse> getOrder(@PathVariable String orderNo) {
        return ApiResponse.ok(orderService.getOrder(orderNo));
    }

    @PostMapping("/orders")
    public ApiResponse<OrderResponse> createOrder(
            @Valid @RequestBody AppManualOrderRequest request,
            HttpServletRequest servletRequest
    ) {
        requireChangedPassword();
        Long userId = currentUser.id();
        String customerId = request.customerId() == null || request.customerId().isBlank()
                ? "WEB-" + userId
                : request.customerId().trim();
        OrderResponse order = orderService.createOrder(new CreateOrderRequest(
                request.quoteNo(),
                customerId,
                request.paymentNo()
        ));
        auditService.record(
                userId,
                userId,
                "MANUAL_ORDER_CREATED",
                "TICKET_ORDER",
                order.orderNo(),
                null,
                order,
                servletRequest
        );
        return ApiResponse.ok(order);
    }

    private void requireChangedPassword() {
        if (currentUser.require().mustChangePassword()) {
            throw new BusinessException("change the initial password before performing business operations");
        }
    }
}
