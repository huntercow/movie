package com.movie.ticket.repository;

import com.movie.ticket.entity.XianyuDeliveryRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface XianyuDeliveryRecordRepository extends JpaRepository<XianyuDeliveryRecord, Long> {
    List<XianyuDeliveryRecord> findByPlatformOrderIdOrderByCreatedAtDesc(String platformOrderId);
}
