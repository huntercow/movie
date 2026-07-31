package com.movie.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.dto.XianyuDeliveryResultRequest;
import com.movie.ticket.dto.XianyuManualOrderRequest;
import com.movie.ticket.entity.XianyuDeliveryRecord;
import com.movie.ticket.entity.XianyuPlatformOrder;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

import java.util.Arrays;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@JsonTest
class XianyuDeliveryResultRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void deliveryResultRequiresAttemptIdOutcomeAndChannel() {
        var violations = validator.validate(new XianyuDeliveryResultRequest("", null, "", null));

        assertThat(violations)
                .extracting(violation -> violation.getPropertyPath().toString())
                .containsExactlyInAnyOrder("attemptId", "success", "channel");
    }

    @Test
    void deliveryResultContractHasNoRawPayloadFieldAndRejectsItDuringBinding() {
        assertThat(Arrays.stream(XianyuDeliveryResultRequest.class.getRecordComponents()))
                .extracting(component -> component.getName())
                .doesNotContain("rawPayload");
        assertThatThrownBy(() -> objectMapper.readValue(
                "{\"attemptId\":\"ATTEMPT_001\",\"success\":true,\"channel\":\"xianyu-mtop\",\"errorMessage\":\"\",\"rawPayload\":\"secret\"}",
                XianyuDeliveryResultRequest.class
        )).isInstanceOf(com.fasterxml.jackson.core.JsonProcessingException.class);
    }

    @Test
    void deliveryEntitiesAndManualRequestExposeNoRawPayloadWritePath() {
        assertThat(Arrays.stream(XianyuDeliveryRecord.class.getDeclaredFields()))
                .extracting(field -> field.getName())
                .doesNotContain("rawPayload");
        assertThat(Arrays.stream(XianyuPlatformOrder.class.getDeclaredFields()))
                .extracting(field -> field.getName())
                .doesNotContain("rawPayload");
        assertThat(Arrays.stream(XianyuManualOrderRequest.class.getRecordComponents()))
                .extracting(component -> component.getName())
                .doesNotContain("rawPayload");
    }

    @Test
    void manualConsoleDoesNotSendRawPayloadToOrderUpdate() throws Exception {
        String source = Files.readString(Path.of("src/main/resources/static/xianyu-manual.html"));
        String updateManual = source.substring(
                source.indexOf("async function updateManual"),
                source.indexOf("function renderEvents")
        );

        assertThat(updateManual).doesNotContain("rawPayload");
    }
}
