package com.movie.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.dto.XianyuAdjustedOrderRequest;
import com.movie.ticket.dto.XianyuPaidVerificationRequest;
import com.movie.ticket.dto.XianyuVerificationFailureRequest;
import com.movie.ticket.dto.XianyuWaitingPaymentRequest;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@JsonTest
class XianyuPaymentRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void waitingPaymentRequestRequiresAllProtocolIdentifiers() {
        var violations = validator.validate(new XianyuWaitingPaymentRequest(
                "", "", "", null, "", ""
        ));

        assertThat(violations)
                .extracting(violation -> violation.getPropertyPath().toString())
                .containsExactlyInAnyOrder(
                        "platformOrderId",
                        "chatId",
                        "buyerUserId",
                        "itemId",
                        "messageId"
                );
    }

    @Test
    void adjustedOrderRequestRequiresPositiveIntegerCents() {
        assertThat(validator.validate(new XianyuAdjustedOrderRequest(0L)))
                .extracting(violation -> violation.getPropertyPath().toString())
                .containsExactly("adjustedAmountCents");
    }

    @Test
    void paidVerificationRequestRequiresPositiveAmountsNonNegativePostFeeAndSource() {
        var violations = validator.validate(new XianyuPaidVerificationRequest(0L, 0L, -1L, null));

        assertThat(violations)
                .extracting(violation -> violation.getPropertyPath().toString())
                .containsExactlyInAnyOrder("paidAmountCents", "itemTotalCents", "postFeeCents", "source");
    }

    @Test
    void verificationFailureRequestRequiresCode() {
        var violations = validator.validate(new XianyuVerificationFailureRequest(null));

        assertThat(violations)
                .extracting(violation -> violation.getPropertyPath().toString())
                .containsExactly("code");
    }

    @Test
    void paidVerificationRejectsMissingPostFeeAfterProductionJsonBinding() throws Exception {
        XianyuPaidVerificationRequest request = objectMapper.readValue(
                "{\"paidAmountCents\":8800,\"itemTotalCents\":8800,\"source\":\"XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT\"}",
                XianyuPaidVerificationRequest.class
        );

        assertThat(validator.validate(request))
                .extracting(violation -> violation.getPropertyPath().toString())
                .containsExactly("postFeeCents");
    }

    @Test
    void paidVerificationRejectsNullPostFeeAfterProductionJsonBinding() throws Exception {
        XianyuPaidVerificationRequest request = objectMapper.readValue(
                "{\"paidAmountCents\":8800,\"itemTotalCents\":8800,\"postFeeCents\":null,\"source\":\"XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT\"}",
                XianyuPaidVerificationRequest.class
        );

        assertThat(validator.validate(request))
                .extracting(violation -> violation.getPropertyPath().toString())
                .containsExactly("postFeeCents");
    }

    @Test
    void paidVerificationAcceptsExplicitZeroPostFeeAfterProductionJsonBinding() throws Exception {
        XianyuPaidVerificationRequest request = objectMapper.readValue(
                "{\"paidAmountCents\":8800,\"itemTotalCents\":8800,\"postFeeCents\":0,\"source\":\"XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT\"}",
                XianyuPaidVerificationRequest.class
        );

        assertThat(validator.validate(request)).isEmpty();
        assertThat(request.postFeeCents()).isZero();
    }

    @Test
    void unknownVerificationFailureCodeIsRejectedDuringJsonBinding() {
        assertThatThrownBy(() -> objectMapper.readValue(
                "{\"code\":\"UNKNOWN_FAILURE_CODE\"}",
                XianyuVerificationFailureRequest.class
        )).isInstanceOf(com.fasterxml.jackson.core.JsonProcessingException.class);
    }

    @Test
    void numericAmountVerificationSourceIsRejectedDuringJsonBinding() {
        assertThatThrownBy(() -> objectMapper.readValue(
                "{\"paidAmountCents\":8800,\"itemTotalCents\":8800,\"postFeeCents\":0,\"source\":0}",
                XianyuPaidVerificationRequest.class
        )).isInstanceOf(com.fasterxml.jackson.core.JsonProcessingException.class);
    }

    @Test
    void numericVerificationFailureCodeIsRejectedDuringJsonBinding() {
        assertThatThrownBy(() -> objectMapper.readValue(
                "{\"code\":0}",
                XianyuVerificationFailureRequest.class
        )).isInstanceOf(com.fasterxml.jackson.core.JsonProcessingException.class);
    }
}
