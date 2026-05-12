package com.movie.ticket.upstream;

public record UploadedImage(
        String imageUrl,
        String upstreamImageId
) {
}
