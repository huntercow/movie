package com.movie.ticket.controller;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.XianyuAdjustedOrderRequest;
import com.movie.ticket.dto.XianyuDeliveryResultRequest;
import com.movie.ticket.dto.XianyuEventRequest;
import com.movie.ticket.dto.XianyuEventResponse;
import com.movie.ticket.dto.XianyuImageMessageRequest;
import com.movie.ticket.dto.XianyuLatestQuoteResponse;
import com.movie.ticket.dto.XianyuManualOrderRequest;
import com.movie.ticket.dto.XianyuOrderResponse;
import com.movie.ticket.dto.XianyuPaidVerificationRequest;
import com.movie.ticket.dto.XianyuQuoteResult;
import com.movie.ticket.dto.XianyuReplyConfigRequest;
import com.movie.ticket.dto.XianyuReplyConfigResponse;
import com.movie.ticket.dto.XianyuVerificationFailureRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentResponse;
import com.movie.ticket.entity.XianyuFulfillmentStatus;
import com.movie.ticket.service.XianyuReplyConfigService;
import com.movie.ticket.service.XianyuService;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/xianyu")
@SecurityRequirement(name = "xianyuPluginToken")
public class XianyuController {

    private final XianyuService xianyuService;
    private final XianyuReplyConfigService replyConfigService;

    public XianyuController(XianyuService xianyuService, XianyuReplyConfigService replyConfigService) {
        this.xianyuService = xianyuService;
        this.replyConfigService = replyConfigService;
    }

    @PostMapping("/messages/image")
    public ApiResponse<XianyuQuoteResult> createQuoteFromImage(@Valid @RequestBody XianyuImageMessageRequest request) {
        return ApiResponse.ok(xianyuService.createQuoteFromImage(request));
    }

    @PostMapping("/orders/waiting-payment")
    public ApiResponse<XianyuWaitingPaymentResponse> registerWaitingPayment(
            @Valid @RequestBody XianyuWaitingPaymentRequest request
    ) {
        return ApiResponse.ok(xianyuService.registerWaitingPayment(request));
    }

    @PostMapping("/orders/{platformOrderId}/adjusted")
    public ApiResponse<XianyuOrderResponse> recordAdjusted(
            @PathVariable String platformOrderId,
            @Valid @RequestBody XianyuAdjustedOrderRequest request
    ) {
        return ApiResponse.ok(xianyuService.recordAdjusted(platformOrderId, request));
    }

    @GetMapping("/orders/waiting-payment/{chatId}")
    public ApiResponse<XianyuOrderResponse> resolveWaitingPaymentOrder(@PathVariable String chatId) {
        return ApiResponse.ok(xianyuService.resolveWaitingPaymentOrder(chatId));
    }

    @PostMapping("/orders/{platformOrderId}/paid-verification")
    public ApiResponse<XianyuOrderResponse> verifyPaid(
            @PathVariable String platformOrderId,
            @Valid @RequestBody XianyuPaidVerificationRequest request
    ) {
        return ApiResponse.ok(xianyuService.verifyPaid(platformOrderId, request));
    }

    @PostMapping("/orders/{platformOrderId}/verification-failures")
    public ApiResponse<XianyuOrderResponse> recordVerificationFailure(
            @PathVariable String platformOrderId,
            @Valid @RequestBody XianyuVerificationFailureRequest request
    ) {
        return ApiResponse.ok(xianyuService.recordVerificationFailure(platformOrderId, request));
    }

    @GetMapping("/orders")
    public ApiResponse<List<XianyuOrderResponse>> listOrders(
            @RequestParam(required = false) XianyuFulfillmentStatus status,
            @RequestParam(required = false) String chatId
    ) {
        return ApiResponse.ok(xianyuService.listOrders(status, chatId));
    }

    @GetMapping("/orders/active/{chatId}")
    public ApiResponse<XianyuOrderResponse> getActiveOrder(@PathVariable String chatId) {
        return ApiResponse.ok(xianyuService.getActiveOrder(chatId));
    }

    @GetMapping("/orders/{platformOrderId}")
    public ApiResponse<XianyuOrderResponse> getOrder(@PathVariable String platformOrderId) {
        return ApiResponse.ok(xianyuService.getOrder(platformOrderId));
    }

    @PostMapping("/orders/{platformOrderId}/manual")
    public ApiResponse<XianyuOrderResponse> updateManualOrder(
            @PathVariable String platformOrderId,
            @Valid @RequestBody XianyuManualOrderRequest request
    ) {
        return ApiResponse.ok(xianyuService.updateManualOrder(platformOrderId, request));
    }

    @GetMapping("/quotes/latest/{chatId}")
    public ApiResponse<XianyuLatestQuoteResponse> getLatestQuote(@PathVariable String chatId) {
        return ApiResponse.ok(xianyuService.getLatestQuote(chatId));
    }

    @GetMapping("/deliveries/pending")
    public ApiResponse<List<XianyuOrderResponse>> pendingDeliveries() {
        return ApiResponse.ok(xianyuService.listPendingDeliveries());
    }

    @PostMapping("/deliveries/{platformOrderId}/claim")
    public ApiResponse<XianyuOrderResponse> claimDelivery(@PathVariable String platformOrderId) {
        return ApiResponse.ok(xianyuService.claimDelivery(platformOrderId));
    }

    @PostMapping("/deliveries/{platformOrderId}/result")
    public ApiResponse<XianyuOrderResponse> deliveryResult(
            @PathVariable String platformOrderId,
            @Valid @RequestBody XianyuDeliveryResultRequest request
    ) {
        return ApiResponse.ok(xianyuService.recordDelivery(platformOrderId, request));
    }

    @PostMapping("/events")
    public ApiResponse<Void> recordEvent(@Valid @RequestBody XianyuEventRequest request) {
        xianyuService.recordEvent(request);
        return ApiResponse.ok(null);
    }

    @GetMapping("/events")
    public ApiResponse<List<XianyuEventResponse>> listEvents(@RequestParam(required = false) String chatId) {
        return ApiResponse.ok(xianyuService.listEvents(chatId));
    }

    @GetMapping("/reply-config")
    public ApiResponse<XianyuReplyConfigResponse> getReplyConfig() {
        return ApiResponse.ok(replyConfigService.getDefaultConfig());
    }

    @PutMapping("/reply-config")
    public ApiResponse<XianyuReplyConfigResponse> saveReplyConfig(@RequestBody XianyuReplyConfigRequest request) {
        return ApiResponse.ok(replyConfigService.saveDefaultConfig(request));
    }
}
