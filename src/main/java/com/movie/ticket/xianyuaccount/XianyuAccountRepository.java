package com.movie.ticket.xianyuaccount;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface XianyuAccountRepository extends JpaRepository<XianyuAccount, Long> {
    List<XianyuAccount> findAllByUserIdOrderByCreatedAtDesc(Long userId);

    Optional<XianyuAccount> findByIdAndUserId(Long id, Long userId);

    Optional<XianyuAccount> findByPlatformAccountId(String platformAccountId);
}
